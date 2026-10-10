# dailyOpenSites
<div align="center">
<img src="https://github.com/ldm0715/dailyOpenSites/blob/main/static/icon.png" alt="icon" width="20%" />
</div>

<div align="center">
<a href="https://greasyfork.org/zh-CN/scripts/581225-dailyopensites"><img alt="Tampermonkey" src="https://img.shields.io/badge/Tampermonkey-v5.5.0-orange?logo=tampermonkey"></a>
<a href="https://greasyfork.org/zh-CN/scripts/581225-dailyopensites"><img alt="Greasy Fork Version" src="https://img.shields.io/greasyfork/v/581225?label=version&color=green"></a>
<img alt="License" src="https://img.shields.io/greasyfork/l/581225?label=license&color=blue">
</div>

一个 Tampermonkey 用户脚本：每天首次访问网页时，自动打开你配置的一组常用网站，并提供可视化界面管理这些网站。

适合每天固定要打开控制台、后台、工具站等页面的场景，无需手动逐个打开，也无需改源码维护列表。

## 功能

主要功能（自动）：每天首次访问网页时自动打开启用的网站（按本地时区，默认 08:00 之后才触发，当天只触发一次，可重置）。

<div align="center">
<img src="https://github.com/ldm0715/dailyOpenSites/blob/main/static/functions.png" alt="functions" width="45%" />
</div>

1. 立即打开所有网站：通过菜单一键打开所有启用网站，同时计入当天记录，当天不会再被自动打开。
2. 控制面板：单独打开网站、用开关即时启用/禁用。
   <div align="center">
      <img src="https://github.com/ldm0715/dailyOpenSites/blob/main/static/panel.png" alt="panel" width="45%" />
   </div>
3. 管理面板：新增、编辑、删除网站，拖拽排序。
   <div align="center">
      <img src="https://github.com/ldm0715/dailyOpenSites/blob/main/static/management.png" alt="management" width="45%" />
   </div>
4. 自定义每日触发时间：在控制面板设置几点之后才触发，默认 08:00。适合网站签到时间晚于 0 点，或者熬夜到凌晨时不想被误触发、把当天机会用掉的情况。
5. 重置今日记录：可重置当天记录，重新触发自动打开。

## 安装

1. 安装插件：扩展 [Tampermonkey](https://www.tampermonkey.net/)
2. 安装脚本（二选一）：
   - 在 Tampermonkey 中新建脚本，把 [`script/auto-open-sites.user.js`](script/auto-open-sites.user.js) 的内容粘贴进去并保存
   - 访问 [dailyOpenSites](https://greasyfork.org/zh-CN/scripts/581225-dailyopensites)，点击安装

## 使用

安装后打开任意网页，脚本会自动执行当天的打开检查。

更多操作可以通过 Tampermonkey 菜单进行：

| 菜单项 | 作用 |
| --- | --- |
| 打开控制面板 | 单独打开网站、即时启用/禁用、设置每日触发时间 |
| 管理网站 | 新增/编辑/删除/排序网站 |
| 立即打开所有网站 | 手动打开全部启用网站，并计入当天记录 |
| 重置今日记录 | 清除当天记录，下次访问重新触发自动打开 |

网站配置保存在 Tampermonkey 存储中，数据结构：

```js
{ name: 'bilibili', url: 'https://www.bilibili.com/', enabled: true }
```

- `name`、`url` 必填，`url` 必须以 `http://` 或 `https://` 开头。
- `enabled` 可选，缺省按启用处理。

每日触发时间单独存在 `triggerTime` 字段，格式 `HH:MM`，缺省 `08:00`，可在控制面板修改。

早于该时间不会自动打开，用于网站签到时间晚于 0 点、或者熬夜到凌晨的情况。注意脚本只在页面加载时运行，没有后台定时能力，所以它是「过了这个时间后，当天第一次加载页面才打开」，而不是「到点自动打开」。

## 常见问题

- **没有自动打开？** 
确认至少有一个网站已启用、URL 合法、今天尚未打开过；是否还没到设定的触发时间（默认 08:00）；刚手动打开过有 10 秒防重复窗口；浏览器可能拦截了批量打开标签页。
- **重置后仍未触发？** 
确认有启用的网站，且目标页面确实加载了脚本。
- **为什么必须新开标签页？** 
脚本只在页面加载时运行，且当前标签页当天检查过就不会重复检查。同一个标签页第二天刷新也会重新触发。
- **什么时候算“新的一天”？** 
按系统本地时区判断，且要过了控制面板里设置的触发时间（默认 08:00）。本地 00:00 到触发时间之间不会打开，避免熬夜到凌晨时误触发、把当天的机会用掉。
- **能指定时间自动打开吗？** 
不能。用户脚本只在页面加载时运行，没有后台定时能力。触发时间只是一道闸门：过了它之后，当天第一次加载页面时才会打开。
- **查看日志：** 
打开浏览器控制台，脚本会输出 `[每日自动打开网站]: ...` 日志。

## 开发

纯前端单文件脚本，无需构建或依赖安装。直接修改仓库中的`script\auto-open-sites.user.js`即可，更详细的模块设计与实现说明见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。本地测试使用的 Tampermonkey 版本为v5.5.0

## License

[MIT](./LICENSE)
