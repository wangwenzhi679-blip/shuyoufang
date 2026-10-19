# 代码结构与维护规范

## 模块职责

- `client/src/`：React 页面、组件、交互与接口请求；通用请求逻辑集中在 `api-client.mjs`，接口地址由 `api-base.mjs` 管理。
- `client/src/AuthScreen.jsx`：登录、注册、邮箱验证及找回密码表单；入口保留登录状态和接口调用编排。
- `client/src/CourseDialogs.jsx`：确认操作、课程与章节改名、新增章节及资料改名弹窗；数据提交与列表刷新由工作区传入的回调负责。
- `client/src/main.jsx`：样式加载与应用挂载入口；保留原模块加载顺序以维持样式层叠，不再包含业务组件实现。
- `client/src/StudentApp.jsx`、`AccountWorkspace.jsx`、`CourseWorkspace.jsx`：分别负责登录会话、账号设置加载与学习工作区编排。
- `client/src/PracticeWorkspace.jsx`：练习列表、答题、题目生成设置、预览与编辑；`ChapterPanels.jsx`：章节草稿、总结与生成设置。
- `client/src/CourseDetail.jsx`：课程详情；`MaterialContent.jsx`：原资料页、章节内容与笔记摘录；`ShelfLibraryModal.jsx`：资料库弹窗。
- `client/src/student-api.mjs`：资料上传及用户端接口基础地址；`StudentContent.jsx` 与 `Brand.jsx`：助手内容和品牌展示组件。
- `server/`：Express 接口与业务模块；`src.js` 为服务入口，账号、课程、学习、生成任务与管理功能按业务文件维护。
- `server/request-schemas.mjs`：账号、课程、章节与练习等接口的输入校验，以及生成结果的结构约束；可独立导入测试，无需启动服务。
- `server/chapter-text.mjs`：章节标题定位与原文切分；直接使用纯函数测试目录排除和章节边界，不通过动态执行源码测试。
- `server/material-text.mjs`：资料文本清理、题块提取与章节相关题目筛选；保留来源信息，与上传、OCR 和存储逻辑分离。
- `server/course-routes.js`：课程修改、删除和章节增删改及排序接口；在入口的既有鉴权与内容控制中间件之后注册。
- `server/auth-routes.js`、`assistant-routes.js`、`practice-routes.js`、`course-query-routes.js`：分别注册账号认证、助手问答、练习与课程查询接口。
- `server/material-routes.js`、`material-reading-routes.js`、`reading-adapters.js`：资料上传与预览、章节原文读取，以及阅读和笔记服务适配。
- `server/chapter-generation-routes.js`、`generation-runner.js`：章节生成接口与后台生成任务编排。
- `server/account-service.js`、`course-data.js`、`practice-data.js`、`material-service.js`：账号服务、课程归属与查询、练习数据、资料处理；运行依赖由入口显式传入，便于隔离测试。
- `shared/`：前后端共享的纯逻辑，避免相同规则在两端重复实现。
- `database/`：数据库基础结构；`docs/`：安装、产品与维护说明。

新增功能优先放入对应业务模块，避免继续扩张入口文件。前端入口负责加载与挂载，后端入口负责运行配置、中间件顺序、模块注册及初始化。部分业务组件仍较大，进一步拆分应随具体业务修改进行，并通过对应回归测试。

## 格式与命名

使用仓库固定版本的 Prettier 和 EditorConfig：代码默认两个空格缩进、单引号、LF 换行和文件末尾换行；PowerShell 使用四个空格缩进，CMD 使用 CRLF。Prettier 支持的文件按 `.prettierrc.json` 检查，忽略范围见 `.prettierignore`。

React 组件使用 PascalCase，普通函数与变量使用 camelCase，固定常量使用 UPPER_SNAKE_CASE。沿用已有业务命名，新增名称应说明用途，避免无关缩写。对既有命名进行修改时，应同时核对调用位置。

注释解释约束、边界、并发顺序和设计原因，不逐行重复代码含义。权限、事务、取消、加密格式及外部资源释放等复杂逻辑应说明关键约定；修改逻辑时同步维护注释。

## 接口与数据处理

- 输入在服务端校验；数据库查询使用参数化值，动态表名等标识符须单独验证。
- 权限判断以服务端当前账号状态与资源归属为准，前端隐藏按钮不能替代权限检查。
- 多步数据写入根据业务需要使用事务，失败时回滚；连接、锁、并发名额和事件监听应在完成或取消后释放。
- 配置与密钥通过私有环境配置或服务配置管理，不写入源码、公开日志和测试快照。
- 错误响应提供可理解的提示，不向用户展示服务密钥或内部堆栈。

## 提交前验证

在项目根目录执行以下检查：

```powershell
npm.cmd run format:check
npm.cmd --prefix client run build
node --test client/src/*.test.mjs shared/*.test.mjs server/first-admin.test.mjs server/request-schemas.test.mjs server/chapter-slicing.test.mjs server/material-text.test.mjs server/course-routes.test.mjs server/route-modules.test.mjs server/long-context.test.mjs server/long-context-retry.test.mjs server/ai-output-budget.test.mjs
git diff --check
```

格式不一致时，使用 `npm.cmd run format`，或只格式化本次修改的文件并检查差异。Prettier 负责格式，不代替逻辑检查和安全审查。

按修改范围补跑对应测试。需要数据库、运行中服务或外部 AI 的集成测试，应使用独立测试环境，并先阅读测试前置条件，避免影响实际学习数据和服务额度。测试通过仅代表对应验证范围，不等同于所有功能完成验收。

每次提交聚焦具体变化，提交前检查差异，保留真实 Git 历史，不提交依赖目录、构建产物、运行数据及私有配置。

## GitHub 自动检查

`.github/workflows/ci.yml` 在推送、合并请求和手动触发时运行：使用 Node.js 22，通过锁文件安装依赖，检查格式、执行上述独立单元测试并构建前端。结果可在仓库 Actions 页面查看。

此流程不启动后端、不连接 MySQL，也不调用 AI 或邮件服务；不需要项目私有环境变量。跳过 Puppeteer 浏览器下载以减少无关安装开销，因此它不覆盖文档渲染及数据库集成测试。自动检查失败时，应查看失败步骤的日志并修复后再提交。
