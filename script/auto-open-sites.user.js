// ==UserScript==
// @name         每日自动打开网站
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  每天第一次打开浏览器时自动打开指定网站，并提供手动打开和网站管理界面
// @author       gcnanmu
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /**
     * Tampermonkey 存储 key 和弹窗 DOM id。
     *
     * 这些字符串会被多个模块复用：
     * - 网站配置模块读写 managedSites。
     * - 每日打开模块读写 lastOpenDate。
     * - 防重复触发模块读写 lastManualOpen。
     * - 弹窗模块用 DOM id 查找并移除旧面板。
     *
     * 集中定义可以避免同一个 key 在不同函数里拼写不一致，尤其是存储 key
     * 一旦写错，就会表现为“配置丢失”或“重置不生效”。
     */
    const STORAGE_KEY_SITES = 'managedSites';
    const STORAGE_KEY_LAST_OPEN_DATE = 'lastOpenDate';
    const STORAGE_KEY_LAST_MANUAL_OPEN = 'lastManualOpen';
    const PANEL_ID = 'auto-open-panel';
    const OVERLAY_ID = 'auto-open-overlay';
    const MANAGER_ID = 'auto-open-manager';

    /**
     * 默认网站列表。
     *
     * 当前数据结构：
     * {
     *   name: string,     // 控制面板和管理面板展示的名称
     *   url: string,      // GM_openInTab 打开的目标地址
     *   enabled: boolean  // 是否参与“打开所有网站”和每日自动打开
     * }
     *
     * 默认列表只在两种情况下使用：
     * 1. 用户还没有保存过 managedSites。
     * 2. managedSites 不是数组。
     *
     * 如果用户明确保存了空数组，表示用户希望网站列表保持为空。
     * 这种情况下不能回退默认列表，否则“删除全部网站并保存”会看起来不生效。
     */
    const DEFAULT_SITES = [
        { name: 'bilibili', url: 'https://www.bilibili.com/', enabled: true }
    ];

    /**
     * 读取网站配置，并对 Tampermonkey 存储中的旧数据或脏数据做基础清洗。
     *
     * 这里做运行时防御，而不是假设存储一定可靠，原因是：
     * - 用户可能从旧版本脚本升级，旧配置没有 enabled 字段。
     * - 用户可能手动修改 Tampermonkey 存储。
     * - 未来修改数据结构时，旧数据仍可能被读取。
     *
     * 清洗策略：
     * - 只保留 name/url 都是字符串的项。
     * - 对 name/url 做 trim。
     * - 空 name 或空 url 的项直接丢弃。
     * - enabled 只有明确为 false 才视为禁用，缺失字段默认启用。
     *
     * @returns {Array<{name: string, url: string, enabled: boolean}>}
     */
    function getSites() {
        const storedSites = GM_getValue(STORAGE_KEY_SITES, null);
        if (storedSites === null || !Array.isArray(storedSites)) {
            return DEFAULT_SITES.slice();
        }

        return storedSites
            .filter((site) => site && typeof site.name === 'string' && typeof site.url === 'string')
            .map((site) => ({
                name: site.name.trim(),
                url: site.url.trim(),
                enabled: site.enabled !== false
            }))
            .filter((site) => site.name && site.url);
    }

    function saveSites(sites) {
        GM_setValue(STORAGE_KEY_SITES, sites);
    }

    /**
     * 获取当天日期字符串。
     *
     * 当前实现使用 toISOString()，生成的是 UTC 日期，不是本地时区日期。
     * 这意味着在东八区凌晨 0 点到 8 点之间，UTC 日期可能仍是前一天。
     * 如果要严格按本地日期判断，需要改成本地年月日拼接。
     *
     * @returns {string} YYYY-MM-DD
     */
    function getTodayString() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * 打开当前配置中的全部启用网站。
     *
     * 重要行为：
     * - 只打开 enabled !== false 的网站。
     * - 打开前写入 lastManualOpen，用来告诉新标签页“这是刚由脚本打开的”。
     * - 每个标签页间隔 500ms，降低浏览器把它当作批量弹窗拦截的概率。
     * - 第一个标签页 active，后续标签页后台插入。
     *
     * @param {{silentEmpty?: boolean}} options
     * @returns {boolean} true 表示确实安排了打开标签页；false 表示没有触发打开
     */
    function openAllSites(options = {}) {
        const allSites = getSites();
        const sites = allSites.filter((site) => site.enabled);
        const silentEmpty = options.silentEmpty === true;

        if (allSites.length === 0) {
            console.log('[每日自动打开网站]: 当前网站列表为空，不触发自动打开逻辑');
            if (!silentEmpty) {
                alert('当前网站列表为空，请先添加网站。');
            }
            return false;
        }

        if (sites.length === 0) {
            console.log('[每日自动打开网站]: 当前没有启用的网站，不触发自动打开逻辑');
            if (!silentEmpty) {
                alert('当前没有启用的网站，请先添加或启用网站。');
            }
            return false;
        }

        // 标记刚刚由脚本主动打开过网站，避免新标签页短时间内再次触发自动打开。
        GM_setValue(STORAGE_KEY_LAST_MANUAL_OPEN, Date.now());

        sites.forEach((site, index) => {
            setTimeout(() => {
                GM_openInTab(site.url, { active: index === 0, insert: true });
            }, index * 500);
        });

        return true;
    }

    /**
     * 每日自动打开入口。
     *
     * 判断逻辑：
     * 1. 从 Tampermonkey 存储读取 lastOpenDate。
     * 2. 和今天日期比较。
     * 3. 如果今天还没有打开过，调用 openAllSites()。
     *
     * 只有真正安排打开标签页时，才写入 lastOpenDate。
     * 如果网站列表为空，或者没有任何启用网站，则不算作今日已触发。
     * 这样用户添加网站后仍能在当天重新触发自动打开逻辑。
     */
    function checkAndAutoOpen() {
        const lastOpenDate = GM_getValue(STORAGE_KEY_LAST_OPEN_DATE, '');
        const today = getTodayString();

        if (lastOpenDate !== today) {
            console.log('[每日自动打开] 检测到今天首次打开浏览器，正在打开网站...');
            if (openAllSites({ silentEmpty: true })) {
                GM_setValue(STORAGE_KEY_LAST_OPEN_DATE, today);
            }
            return;
        }

        console.log('[每日自动打开] 今天已经打开过，跳过自动打开');
    }

    /**
     * 确保 document.body 可用后再执行 DOM 操作。
     *
     * 脚本配置了 @run-at document-start，此时页面 body 可能还没创建。
     * 自动打开逻辑不依赖 body，可以尽早执行；但控制面板和管理面板需要 appendChild，
     * 所以菜单入口统一通过这个函数延迟到 DOMContentLoaded。
     *
     * @param {Function} callback body 可用后执行的回调
     */
    function ensureBodyReady(callback) {
        if (document.body) {
            callback();
            return;
        }

        window.addEventListener('DOMContentLoaded', callback, { once: true });
    }

    /**
     * 关闭指定弹窗，并同步移除共享遮罩。
     *
     * 这里不只移除 panel，也要移除 overlay。否则面板消失后遮罩仍覆盖页面，
     * 用户会感觉原网页无法点击。
     *
     * @param {string} panelId 要关闭的面板 DOM id
     */
    function closeModal(panelId) {
        const panel = document.getElementById(panelId);
        const overlay = document.getElementById(OVERLAY_ID);

        if (panel) {
            panel.remove();
        }

        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * 创建弹窗遮罩。
     *
     * 创建前会先移除旧遮罩，保证页面上最多只有一个 overlay。
     * 这个脚本运行在任意网站上，不知道目标页面自己的 z-index 体系，
     * 所以使用较高 z-index 来尽量保证面板可见。
     *
     * @returns {HTMLDivElement}
     */
    function createOverlay() {
        const existingOverlay = document.getElementById(OVERLAY_ID);
        if (existingOverlay) {
            existingOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999998;
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * 创建控制面板和管理面板共用的弹窗骨架。
     *
     * 统一处理：
     * - 关闭旧控制面板和旧管理面板，避免两个弹窗重叠。
     * - 创建遮罩。
     * - 创建居中弹窗容器。
     * - 点击遮罩关闭当前面板。
     *
     * @param {string} panelId 面板 DOM id
     * @param {string} titleText 标题文案
     * @param {string} width CSS 宽度表达式，例如 360px / 520px
     * @returns {HTMLDivElement}
     */
    function createBasePanel(panelId, titleText, width = '360px') {
        closeModal(PANEL_ID);
        closeModal(MANAGER_ID);

        const overlay = createOverlay();
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(${width}, calc(100vw - 32px));
            max-height: calc(100vh - 32px);
            overflow-y: auto;
            background: #ffffff;
            border: 1px solid #cfcfcf;
            border-radius: 8px;
            padding: 16px;
            z-index: 999999;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
            font-family: Arial, sans-serif;
            color: #222;
        `;

        const title = document.createElement('h3');
        title.textContent = titleText;
        title.style.cssText = 'margin: 0 0 12px; font-size: 18px; text-align: center;';
        panel.appendChild(title);

        overlay.onclick = () => closeModal(panelId);
        document.body.appendChild(panel);

        return panel;
    }

    /**
     * 创建主操作按钮。
     *
     * 用于控制面板和管理面板底部的大按钮，例如“打开所有网站”“保存配置”。
     * 行内小按钮使用 createSmallButton()，避免尺寸混用。
     *
     * @param {string} text 按钮文案
     * @param {string} background 默认背景色
     * @param {string} hoverBackground hover 背景色
     * @param {Function} onClick 点击回调
     * @returns {HTMLButtonElement}
     */
    function createActionButton(text, background, hoverBackground, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.style.cssText = `
            display: block;
            width: 100%;
            padding: 10px 12px;
            margin: 8px 0;
            background: ${background};
            color: #fff;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        `;
        button.onmouseover = () => {
            button.style.background = hoverBackground;
        };
        button.onmouseout = () => {
            button.style.background = background;
        };
        button.onclick = onClick;
        return button;
    }

    /**
     * 在控制面板中切换单个网站启用状态。
     *
     * 控制面板属于快捷操作入口，用户点击开关后预期立即生效，
     * 所以这里直接读取完整配置、修改对应下标、马上写回 Tampermonkey 存储。
     *
     * 注意：targetIndex 必须来自 getSites() 当前返回数组的下标。
     * 当前控制面板渲染和点击回调在同一次渲染周期内使用同一个 index，
     * 因此不会出现排序变化后 index 错位的问题。
     *
     * @param {number} targetIndex getSites() 返回列表中的网站下标
     * @param {boolean} enabled 新的启用状态
     */
    function updateSiteEnabled(targetIndex, enabled) {
        const sites = getSites();
        sites[targetIndex].enabled = enabled;
        saveSites(sites);
    }

    /**
     * 创建滑动开关组件。
     *
     * 设计说明：
     * - 使用 button 而不是 checkbox，是为了完全控制视觉样式并减少跨网站 CSS 干扰。
     * - 使用 role="switch" 和 aria-checked 暴露开关语义。
     * - 内部 span(knob) 作为滑块圆点，通过 transform 移动位置。
     * - 组件内部只维护视觉状态；状态如何保存由 onChange 的调用方决定。
     *
     * 使用场景：
     * - 控制面板：onChange 里立即 saveSites()。
     * - 管理面板：onChange 只更新当前行状态，点击“保存配置”后统一持久化。
     *
     * @param {boolean} checked 初始是否启用
     * @param {(checked: boolean, event: MouseEvent) => void} onChange 状态变化回调
     * @returns {HTMLButtonElement}
     */
    function createToggleSwitch(checked, onChange) {
        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.setAttribute('role', 'switch');
        switchBtn.title = checked ? '已启用，点击禁用' : '已禁用，点击启用';
        switchBtn.style.cssText = `
            position: relative;
            flex: 0 0 auto;
            width: 46px;
            height: 26px;
            padding: 0;
            border: none;
            border-radius: 999px;
            cursor: pointer;
            transition: background 0.18s ease;
            vertical-align: middle;
        `;

        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 3px;
            left: 3px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
            transition: transform 0.18s ease;
        `;

        // 将状态同步到视觉样式和无障碍属性，避免文字按钮式的状态不清晰。
        function sync(nextChecked) {
            checked = nextChecked;
            switchBtn.setAttribute('aria-checked', String(checked));
            switchBtn.title = checked ? '已启用，点击禁用' : '已禁用，点击启用';
            switchBtn.style.background = checked ? '#22c55e' : '#cbd5e1';
            knob.style.transform = checked ? 'translateX(20px)' : 'translateX(0)';
        }

        switchBtn.onclick = (event) => {
            // 开关经常放在可点击行内，阻止冒泡避免同时触发行展开/收起。
            event.stopPropagation();
            sync(!checked);
            onChange(checked, event);
        };

        switchBtn.appendChild(knob);
        sync(checked);
        return switchBtn;
    }

    /**
     * 创建快速打开控制面板。
     *
     * 面板职责：
     * - 展示所有网站。
     * - 启用网站可以直接点击打开。
     * - 禁用网站仍展示，但点击打开时提示先启用。
     * - 每个网站右侧提供滑动开关，切换后立即保存。
     * - 提供“打开所有网站”“管理网站”“关闭”入口。
     *
     * 这里没有过滤禁用网站，是因为用户需要从控制面板重新启用它们。
     */
    function createControlPanel() {
        const panel = createBasePanel(PANEL_ID, '网站快速打开');
        const sites = getSites();

        if (sites.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '当前没有网站，请先进入“管理网站”添加。';
            empty.style.cssText = 'margin: 12px 0; color: #666; text-align: center;';
            panel.appendChild(empty);
        }

        sites.forEach((site, index) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 8px;
                align-items: center;
                margin: 8px 0;
            `;

            const btn = createActionButton(site.name, site.enabled ? '#4caf50' : '#9e9e9e', site.enabled ? '#449d48' : '#8a8a8a', () => {
                if (!site.enabled) {
                    alert('该网站已禁用，请先启用后再打开。');
                    return;
                }

                GM_openInTab(site.url, { active: true });
            });
            btn.style.margin = '0';

            const toggleSwitch = createToggleSwitch(site.enabled, (nextEnabled) => {
                // 控制面板是日常快捷入口，切换状态后立即保存并重绘当前面板。
                updateSiteEnabled(index, nextEnabled);
                createControlPanel();
            });

            row.appendChild(btn);
            row.appendChild(toggleSwitch);
            panel.appendChild(row);
        });

        panel.appendChild(createActionButton('打开所有网站', '#2196f3', '#0b7dda', () => {
            openAllSites();
        }));

        panel.appendChild(createActionButton('管理网站', '#ff9800', '#e68900', () => {
            createSiteManager();
        }));

        panel.appendChild(createActionButton('关闭', '#f44336', '#da190b', () => {
            closeModal(PANEL_ID);
        }));
    }

    /**
     * 创建一组 label + input。
     *
     * 管理面板里每个网站都需要名称和网址两个字段。
     * 封装这个函数可以保证输入框样式一致，也能让 createSiteRow()
     * 只关心字段含义，不重复写 DOM 结构。
     *
     * @param {string} labelText 标签文案
     * @param {string} value 初始值
     * @param {string} placeholder 输入提示
     * @returns {{wrapper: HTMLDivElement, input: HTMLInputElement}}
     */
    function createField(labelText, value, placeholder) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: grid; gap: 5px; margin-bottom: 8px;';

        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.cssText = 'font-size: 12px; color: #555;';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.placeholder = placeholder;
        input.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid #ccc;
            border-radius: 6px;
            font-size: 14px;
        `;

        wrapper.appendChild(label);
        wrapper.appendChild(input);

        return { wrapper, input };
    }

    /**
     * 获取 URL 的展示摘要。
     *
     * 折叠行空间有限，只展示 hostname 比展示完整 URL 更容易扫视。
     * 新增网站时 URL 可能为空或不完整，new URL() 会抛异常，
     * 所以这里使用 try/catch fallback，避免输入过程导致整个管理面板崩溃。
     *
     * @param {string} url 用户输入的网址
     * @returns {string} hostname、原始文本或“未设置网址”
     */
    function getUrlDisplay(url) {
        try {
            return new URL(url).hostname;
        } catch (error) {
            return url || '未设置网址';
        }
    }

    /**
     * 创建行内小按钮。
     *
     * 当前主要用于“编辑/收起”和“删除”。
     * 早期启用/禁用也使用小按钮，后来改成 createToggleSwitch()，
     * 因此这里保留 hover 色 dataset 逻辑，方便未来有动态按钮时复用。
     *
     * @param {string} text 按钮文案
     * @param {string} background 默认背景色
     * @param {string} hoverBackground hover 背景色
     * @param {Function} onClick 点击回调
     * @returns {HTMLButtonElement}
     */
    function createSmallButton(text, background, hoverBackground, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.dataset.background = background;
        button.dataset.hoverBackground = hoverBackground;
        button.style.cssText = `
            flex: 0 0 auto;
            min-width: 54px;
            padding: 6px 9px;
            background: ${background};
            color: #fff;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            line-height: 1.2;
        `;
        button.onmouseover = () => {
            button.style.background = button.dataset.hoverBackground;
        };
        button.onmouseout = () => {
            button.style.background = button.dataset.background;
        };
        button.onclick = onClick;
        return button;
    }

    /**
     * 创建拖拽把手组件。
     *
     * 只让这个小控件 draggable，而不是让整行 draggable，原因是：
     * - 整行可拖会影响点击行展开/收起。
     * - 展开后输入框中选择文本时也可能误触拖拽。
     * - 明确的拖拽把手更符合用户对排序控件的预期。
     *
     * 视觉上使用胶囊形轨道和三条竖线，模拟常见 grip/slider 控件。
     *
     * @returns {HTMLButtonElement}
     */
    function createDragHandle() {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.draggable = true;
        handle.title = '拖动调整顺序';
        handle.style.cssText = `
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 42px;
            height: 26px;
            padding: 0;
            background: #eef2f7;
            border: 1px solid #cbd5e1;
            border-radius: 999px;
            cursor: grab;
            box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
        `;

        const grip = document.createElement('span');
        grip.style.cssText = `
            display: inline-flex;
            gap: 3px;
            align-items: center;
            justify-content: center;
        `;

        // 三条竖线模拟常见的 grip/slider 控件，比“拖动”文字按钮更节省空间。
        for (let i = 0; i < 3; i++) {
            const bar = document.createElement('span');
            bar.style.cssText = `
                width: 2px;
                height: 12px;
                border-radius: 999px;
                background: #64748b;
            `;
            grip.appendChild(bar);
        }

        handle.onmousedown = () => {
            handle.style.cursor = 'grabbing';
        };
        handle.onmouseup = () => {
            handle.style.cursor = 'grab';
        };
        handle.onclick = (event) => {
            event.stopPropagation();
        };
        handle.appendChild(grip);
        return handle;
    }

    /**
     * 给管理列表绑定拖拽排序。
     *
     * 实现方式：
     * - dragstart 时，createSiteRow() 会把当前行暂存到 listContainer.draggedRow。
     * - dragover 时，根据鼠标在目标行的上半区/下半区决定插到目标行前面或后面。
     * - 这里只移动 DOM 节点，不立即写入存储。
     * - 用户点击“保存配置”时，collectSites() 按当前 DOM 顺序收集数据并持久化。
     *
     * 这样做的好处是拖拽过程可取消：用户如果拖错了，直接点“取消”即可不保存。
     *
     * @param {HTMLDivElement} listContainer 网站行容器
     */
    function setupDragSorting(listContainer) {
        listContainer.addEventListener('dragover', (event) => {
            const draggedRow = listContainer.draggedRow;
            if (!draggedRow) {
                return;
            }

            const targetElement = event.target instanceof Element ? event.target : event.target.parentElement;
            const targetRow = targetElement ? targetElement.closest('[data-site-row="true"]') : null;
            if (!targetRow || targetRow === draggedRow || targetRow.parentElement !== listContainer) {
                return;
            }

            event.preventDefault();
            const targetRect = targetRow.getBoundingClientRect();
            // 鼠标在目标行下半区时插到目标行后面，否则插到目标行前面。
            const shouldInsertAfter = event.clientY > targetRect.top + targetRect.height / 2;
            listContainer.insertBefore(draggedRow, shouldInsertAfter ? targetRow.nextSibling : targetRow);
        });

        listContainer.addEventListener('drop', (event) => {
            if (listContainer.draggedRow) {
                event.preventDefault();
            }
        });
    }

    /**
     * 校验单个网站数据。
     *
     * 用于每行独立保存：只检查这一个网站本身是否合法（名称、网址非空，
     * 网址必须以 http:// 或 https:// 开头）。跨网站的重名/重 URL 冲突
     * 由 saveSingleSite() 结合当前存储另行处理。
     *
     * @param {{name: string, url: string}} site
     * @returns {boolean} true 表示通过校验
     */
    function validateSingleSite(site) {
        if (!site.name || !site.url) {
            alert('名称和网址都不能为空。');
            return false;
        }

        if (!/^https?:\/\//i.test(site.url)) {
            alert(`网址格式不正确：${site.url}\n请使用 http:// 或 https:// 开头。`);
            return false;
        }

        return true;
    }

    /**
     * 保存单个网站到存储（upsert）。
     *
     * 设计目的：让每行的“保存”按钮只影响这一个网站，避免每次小改动都走
     * collectSites() 的全量收集与去重逻辑。
     *
     * 定位策略：
     * - prevKey 是这一行上次保存时使用的 URL（小写），用来在存储中找到旧记录。
     * - 新行没有 prevKey，按新增处理。
     *
     * 冲突校验（与存储中的其他网站比较，排除自身旧记录）：
     * - 名称重复直接拒绝。
     * - URL 重复需用户确认覆盖；确认后用当前数据覆盖那条旧记录。
     *
     * @param {{name: string, url: string, enabled: boolean}} site 当前行数据
     * @param {string|null} prevKey 该行上次保存使用的 URL key（小写），新行为 null
     * @returns {string|null} 保存成功返回新的 URL key（小写）；失败返回 null
     */
    function saveSingleSite(site, prevKey) {
        if (!validateSingleSite(site)) {
            return null;
        }

        const sites = getSites();
        const nameKey = site.name.toLowerCase();
        const urlKey = site.url.toLowerCase();

        // 自身旧记录的下标：优先按 prevKey 定位，避免误判为与他人冲突。
        const selfIndex = prevKey === null
            ? -1
            : sites.findIndex((item) => item.url.toLowerCase() === prevKey);

        const nameConflict = sites.some((item, index) =>
            index !== selfIndex && item.name.toLowerCase() === nameKey);
        if (nameConflict) {
            alert(`名称重复：${site.name}\n请更换网站名称。`);
            return null;
        }

        const urlConflictIndex = sites.findIndex((item, index) =>
            index !== selfIndex && item.url.toLowerCase() === urlKey);
        if (urlConflictIndex !== -1) {
            const existingSite = sites[urlConflictIndex];
            const shouldOverwrite = confirm(
                `URL 已存在：${site.url}\n\n` +
                `已有网站：${existingSite.name}\n` +
                `当前网站：${site.name}\n\n` +
                '是否用当前网站配置覆盖已有配置？'
            );
            if (!shouldOverwrite) {
                return null;
            }
            // 覆盖语义：移除那条相同 URL 的旧记录，下面再写入当前数据。
            sites.splice(urlConflictIndex, 1);
        }

        // splice 可能改变 selfIndex 之后元素的位置，保存前重新按 prevKey 定位自身。
        const writeIndex = prevKey === null
            ? -1
            : sites.findIndex((item) => item.url.toLowerCase() === prevKey);

        if (writeIndex === -1) {
            sites.push(site);
        } else {
            sites[writeIndex] = site;
        }

        saveSites(sites);
        return urlKey;
    }

    /**
     * 从存储中删除指定 key（URL 小写）对应的网站。
     *
     * 用于每行“删除”按钮的即时持久化：已保存过的行删除后立即写回存储，
     * 不依赖底部“保存配置”。未保存过的新行没有 key，调用方直接移除 DOM 即可。
     *
     * @param {string} key 该行保存时使用的 URL key（小写）
     */
    function deleteSiteByKey(key) {
        const sites = getSites().filter((item) => item.url.toLowerCase() !== key);
        saveSites(sites);
    }

    /**
     * 按当前 DOM 顺序持久化已保存网站的排序。
     *
     * 拖拽结束后立即调用：只对“已保存过”的行（带 siteKey）按 DOM 顺序重排，
     * 未保存的新行不参与，避免把未确认的数据写入存储。
     *
     * @param {HTMLDivElement} listContainer 网站行容器
     */
    function persistOrder(listContainer) {
        const orderedKeys = Array.from(listContainer.children)
            .filter((child) => child.dataset && child.dataset.siteKey)
            .map((child) => child.dataset.siteKey);

        if (orderedKeys.length === 0) {
            return;
        }

        const sites = getSites();
        const byKey = new Map(sites.map((item) => [item.url.toLowerCase(), item]));
        const ordered = [];

        orderedKeys.forEach((key) => {
            if (byKey.has(key)) {
                ordered.push(byKey.get(key));
                byKey.delete(key);
            }
        });
        // 存储中存在但当前列表未覆盖的网站（理论上不应出现）追加到末尾，避免丢数据。
        byKey.forEach((item) => ordered.push(item));

        saveSites(ordered);
    }

    /**
     * 创建单个网站的管理行。
     *
     * 行结构：
     * - 左侧：拖拽把手，用于调整排序。
     * - 中间：摘要信息，包括名称、域名摘要、启用状态。
     * - 右侧：滑动开关、编辑/收起按钮、删除按钮。
     * - 下方详情区：展开后显示名称和网址输入框。
     *
     * 保存策略：
     * - 本函数内部维护 enabled 和 expanded 两个临时状态。
     * - 名称和 URL 直接存在 input.value 中。
     * - row.getSiteData() 统一导出当前行数据。
     * - collectSites() 保存时按 DOM 顺序调用 getSiteData()，因此拖拽排序天然生效。
     *
     * @param {{name: string, url: string, enabled?: boolean}} site 网站配置
     * @param {HTMLDivElement} listContainer 当前行所在容器
     * @param {boolean} expandedByDefault 是否默认展开
     * @returns {HTMLDivElement}
     */
    function createSiteRow(site, listContainer, expandedByDefault = false) {
        const row = document.createElement('div');
        row.dataset.siteRow = 'true';
        // 已保存过的行用 siteKey（URL 小写）标识，供单行保存/删除和排序持久化定位。
        // 新增但未保存的行没有 siteKey。
        if (site.url) {
            row.dataset.siteKey = site.url.trim().toLowerCase();
        }
        row.style.cssText = `
            border: 1px solid #e2e2e2;
            border-radius: 6px;
            margin-bottom: 8px;
            background: #fafafa;
            overflow: hidden;
        `;

        const nameField = createField('名称', site.name, '例如：控制台');
        const urlField = createField('网址', site.url, 'https://example.com');
        let enabled = site.enabled !== false;
        let expanded = expandedByDefault;

        const header = document.createElement('div');
        header.style.cssText = `
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 10px;
            align-items: center;
            padding: 9px 10px;
            cursor: pointer;
        `;

        const summary = document.createElement('div');
        summary.style.cssText = 'min-width: 0;';

        const nameText = document.createElement('div');
        nameText.style.cssText = `
            overflow: hidden;
            color: #222;
            font-size: 14px;
            font-weight: 600;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;

        const urlText = document.createElement('div');
        urlText.style.cssText = `
            overflow: hidden;
            margin-top: 2px;
            color: #666;
            font-size: 12px;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;

        const statusText = document.createElement('div');
        statusText.style.cssText = `
            margin-top: 2px;
            color: #888;
            font-size: 12px;
        `;

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        const detail = document.createElement('div');
        detail.style.cssText = `
            display: ${expanded ? 'block' : 'none'};
            padding: 0 10px 10px;
            border-top: 1px solid #e8e8e8;
        `;

        // 摘要和详情共用同一组 input，输入变化时同步刷新折叠态文案。
        function refreshSummary() {
            nameText.textContent = nameField.input.value.trim() || '未命名网站';
            urlText.textContent = getUrlDisplay(urlField.input.value.trim());
            statusText.textContent = enabled ? '已启用' : '已禁用';
            row.style.opacity = enabled ? '1' : '0.72';
            editBtn.textContent = expanded ? '收起' : '编辑';
            detail.style.display = expanded ? 'block' : 'none';
        }

        const dragHandle = createDragHandle();
        dragHandle.ondragstart = (event) => {
            event.stopPropagation();
            // 把当前拖拽行临时挂到容器上，dragover 时直接移动这个 DOM 节点。
            listContainer.draggedRow = row;
            row.style.opacity = '0.45';
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', nameField.input.value.trim() || 'site');
        };
        dragHandle.ondragend = () => {
            // 拖拽结束后清理临时状态，并按启用状态恢复透明度。
            listContainer.draggedRow = null;
            refreshSummary();
            // 拖拽排序立即持久化：只重排已保存过的行，未保存的新行不参与。
            persistOrder(listContainer);
        };

        const toggleSwitch = createToggleSwitch(enabled, (nextEnabled) => {
            // 管理面板中的修改先停留在当前 DOM 行，点击“保存配置”后统一持久化。
            enabled = nextEnabled;
            refreshSummary();
        });

        const editBtn = createSmallButton(expanded ? '收起' : '编辑', '#2196f3', '#0b7dda', (event) => {
            // 阻止冒泡，避免点击编辑按钮时又触发行 header 的展开切换。
            event.stopPropagation();
            expanded = !expanded;
            refreshSummary();
        });

        // 行内“保存”按钮：只校验并写入当前这一个网站，不触发全量收集逻辑。
        const saveRowBtn = createActionButton('保存', '#2196f3', '#0b7dda', () => {
            const data = {
                name: nameField.input.value.trim(),
                url: urlField.input.value.trim(),
                enabled
            };
            // prevKey 为该行上次保存使用的 key；新行为 null，按新增处理。
            const prevKey = row.dataset.siteKey || null;
            const newKey = saveSingleSite(data, prevKey);
            if (newKey === null) {
                return;
            }
            // 保存成功后更新 siteKey，后续编辑会基于新 key 在存储中原地更新。
            row.dataset.siteKey = newKey;
            expanded = false;
            refreshSummary();
            alert('该网站已保存。');
        });
        saveRowBtn.style.marginTop = '4px';

        const removeBtn = createSmallButton('删除', '#f44336', '#da190b', (event) => {
            // 删除按钮也要阻止冒泡，否则删除前会先触发展开/收起。
            event.stopPropagation();
            if (!confirm(`确定要删除网站“${nameField.input.value.trim() || '未命名网站'}”吗？`)) {
                return;
            }
            // 已保存过的行立即从存储移除；未保存的新行只移除 DOM。
            if (row.dataset.siteKey) {
                deleteSiteByKey(row.dataset.siteKey);
            }
            row.remove();
            if (!listContainer.children.length) {
                listContainer.appendChild(createEmptyRowHint());
            }
        });

        header.onclick = () => {
            expanded = !expanded;
            refreshSummary();
        };

        nameField.input.addEventListener('input', refreshSummary);
        urlField.input.addEventListener('input', refreshSummary);

        summary.appendChild(nameText);
        summary.appendChild(urlText);
        summary.appendChild(statusText);
        actions.appendChild(toggleSwitch);
        actions.appendChild(editBtn);
        actions.appendChild(removeBtn);
        header.appendChild(dragHandle);
        header.appendChild(summary);
        header.appendChild(actions);
        detail.appendChild(nameField.wrapper);
        detail.appendChild(urlField.wrapper);
        detail.appendChild(saveRowBtn);
        row.appendChild(header);
        row.appendChild(detail);

        // 保存时由 collectSites() 统一调用，避免外部依赖这一行内部 DOM 结构。
        row.getSiteData = () => ({
            name: nameField.input.value.trim(),
            url: urlField.input.value.trim(),
            enabled
        });

        refreshSummary();
        return row;
    }

    /**
     * 创建空列表提示。
     *
     * 管理面板中删除最后一个网站后，需要给用户一个明确反馈，
     * 否则面板中间会变成一片空白，看起来像渲染失败。
     *
     * @returns {HTMLDivElement}
     */
    function createEmptyRowHint() {
        const hint = document.createElement('div');
        hint.dataset.emptyHint = 'true';
        hint.textContent = '还没有网站，点“新增网站”添加。';
        hint.style.cssText = 'padding: 10px 0; color: #666; text-align: center;';
        return hint;
    }

    /**
     * 清理空列表提示。
     *
     * 当用户点击“新增网站”时，如果当前只有 empty hint，
     * 需要先移除提示，再插入真正的网站配置行，避免提示和表单同时出现。
     *
     * @param {HTMLDivElement} container 网站列表容器
     */
    function clearEmptyHint(container) {
        const hint = container.querySelector('[data-empty-hint="true"]');
        if (hint) {
            hint.remove();
        }
    }

    /**
     * 收集并校验管理面板中的网站配置。
     *
     * 数据来源：
     * - 每个 createSiteRow() 返回的 row 都挂载了 getSiteData()。
     * - 当前函数只读取有 getSiteData() 的子节点，因此 empty hint 不会被当作网站。
     * - 读取顺序就是 DOM 顺序，所以拖拽排序后的结果会自然进入保存数据。
     *
     * 校验策略：
     * - 名称和网址不能为空。
     * - URL 必须以 http:// 或 https:// 开头。
     * - 名称不能重复，重复时提示用户更换。
     * - URL 可以重复，但必须经过用户确认；确认后用当前行覆盖旧行。
     *
     * 返回值约定：
     * - 返回数组：可以保存。
     * - 返回 null：校验失败，保存按钮应停止后续流程。
     *
     * @param {HTMLDivElement} listContainer 网站列表容器
     * @returns {Array<{name: string, url: string, enabled: boolean}> | null}
     */
    function collectSites(listContainer) {
        const rows = Array.from(listContainer.children).filter((child) => typeof child.getSiteData === 'function');
        const sites = rows.map((row) => row.getSiteData());
        const nextSites = [];
        const nameSet = new Set();
        let urlIndexByKey = new Map();

        function rebuildUrlIndex() {
            urlIndexByKey = new Map();
            nextSites.forEach((site, index) => {
                urlIndexByKey.set(site.url.toLowerCase(), index);
            });
        }

        for (const site of sites) {
            if (!site.name || !site.url) {
                alert('名称和网址都不能为空。');
                return null;
            }

            if (!/^https?:\/\//i.test(site.url)) {
                alert(`网址格式不正确：${site.url}\n请使用 http:// 或 https:// 开头。`);
                return null;
            }

            const nameKey = site.name.toLowerCase();
            if (nameSet.has(nameKey)) {
                alert(`名称重复：${site.name}\n请更换网站名称。`);
                return null;
            }

            const urlKey = site.url.toLowerCase();
            if (urlIndexByKey.has(urlKey)) {
                const existingIndex = urlIndexByKey.get(urlKey);
                const existingSite = nextSites[existingIndex];
                const shouldOverwrite = confirm(
                    `URL 已存在：${site.url}\n\n` +
                    `已有网站：${existingSite.name}\n` +
                    `当前网站：${site.name}\n\n` +
                    '是否用当前网站配置覆盖已有配置？'
                );

                if (!shouldOverwrite) {
                    return null;
                }

                // 覆盖语义：移除之前相同 URL 的配置，再把当前行作为新配置写入。
                // 这样保存后的顺序以用户当前看到的 DOM 顺序为准。
                nameSet.delete(existingSite.name.toLowerCase());
                nextSites.splice(existingIndex, 1);
                rebuildUrlIndex();
            }

            nameSet.add(nameKey);
            nextSites.push(site);
            urlIndexByKey.set(urlKey, nextSites.length - 1);
        }

        return nextSites;
    }

    /**
     * 创建网站管理面板。
     *
     * 面板职责：
     * - 渲染当前网站配置列表。
     * - 允许新增、编辑、删除、启用/禁用和拖拽排序。
     * - 点击“保存配置”时统一收集 DOM 当前状态并写入 Tampermonkey 存储。
     * - 点击“取消”时直接关闭，不保存本次面板中的临时修改。
     *
     * 保存时机设计：
     * 管理面板里有多种临时操作，尤其是拖拽排序。如果每拖一次就保存，
     * 用户很难撤销误操作。因此这里采用“临时编辑 + 保存按钮统一提交”的模式。
     */
    function createSiteManager() {
        const panel = createBasePanel(MANAGER_ID, '管理网站', '520px');
        const sites = getSites();

        const desc = document.createElement('div');
        desc.textContent = '你可以在这里新增、修改、启用、禁用或拖拽排序自动打开的网站。';
        desc.style.cssText = 'margin-bottom: 12px; color: #555; font-size: 13px;';
        panel.appendChild(desc);

        const listContainer = document.createElement('div');
        setupDragSorting(listContainer);
        panel.appendChild(listContainer);

        if (sites.length === 0) {
            listContainer.appendChild(createEmptyRowHint());
        } else {
            sites.forEach((site) => {
                listContainer.appendChild(createSiteRow(site, listContainer));
            });
        }

        const addBtn = createActionButton('新增网站', '#4caf50', '#449d48', () => {
            clearEmptyHint(listContainer);
            listContainer.appendChild(createSiteRow({ name: '', url: '', enabled: true }, listContainer, true));
        });
        addBtn.style.marginTop = '12px';
        panel.appendChild(addBtn);

        const saveBtn = createActionButton('保存配置', '#2196f3', '#0b7dda', () => {
            const nextSites = collectSites(listContainer);
            if (!nextSites) {
                return;
            }

            saveSites(nextSites);
            alert('网站配置已保存。');
            closeModal(MANAGER_ID);
        });
        panel.appendChild(saveBtn);

        const cancelBtn = createActionButton('取消', '#9e9e9e', '#7f7f7f', () => {
            closeModal(MANAGER_ID);
        });
        panel.appendChild(cancelBtn);
    }

    /**
     * Tampermonkey 菜单入口。
     *
     * 需要创建 DOM 的命令必须通过 ensureBodyReady()：
     * - 打开控制面板
     * - 管理网站
     *
     * 不依赖 DOM 的命令可以直接执行：
     * - 立即打开所有网站
     * - 重置今日记录
     */
    GM_registerMenuCommand('打开控制面板', () => {
        ensureBodyReady(createControlPanel);
    });

    GM_registerMenuCommand('管理网站', () => {
        ensureBodyReady(createSiteManager);
    });

    GM_registerMenuCommand('立即打开所有网站', () => {
        openAllSites();
    });

    GM_registerMenuCommand('重置今日记录', () => {
        // lastOpenDate 控制“今天是否已经自动打开过”。
        GM_setValue(STORAGE_KEY_LAST_OPEN_DATE, '');
        // lastManualOpen 控制“最近是否刚由脚本打开过网站”，重置时也清掉，避免 10 秒窗口继续跳过检查。
        GM_setValue(STORAGE_KEY_LAST_MANUAL_OPEN, 0);
        // sessionStorage 标记当前标签页已经检查过；不清它，同一标签页访问新页面仍不会再次触发。
        sessionStorage.removeItem('autoOpenChecked');
        alert('今日记录已重置，下次访问或刷新页面会再次触发自动打开。');
    });

    /**
     * 启动阶段的防重复逻辑。
     *
     * 需要同时考虑两种重复来源：
     * 1. 同一个标签页里脚本重复运行：用 sessionStorage.autoOpenChecked 阻止。
     * 2. openAllSites() 打开的新标签页也会运行脚本：用 lastManualOpen 的 10 秒窗口阻止。
     *
     * 如果两个条件都允许，才执行 checkAndAutoOpen()。
     */
    const lastManualOpen = GM_getValue(STORAGE_KEY_LAST_MANUAL_OPEN, 0);
    const now = Date.now();
    const isRecentlyManuallyOpened = lastManualOpen && (now - lastManualOpen) < 10000;

    if (!sessionStorage.getItem('autoOpenChecked') && !isRecentlyManuallyOpened) {
        sessionStorage.setItem('autoOpenChecked', 'true');
        checkAndAutoOpen();
    }
})();
