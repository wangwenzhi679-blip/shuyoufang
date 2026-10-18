# 历史代码摘录

整理日期：2026-10-19。以下片段摘自本机保留的阶段文件，按原行号截取，未进行代码格式化。原件校验值、文件大小和观察到的修改时间见 [原始文件清单](source-manifest.json)。

这些片段用于展示实际保留的代码形态，不作为当前运行代码，也不据此断言整项功能在该日已经完成。未附上真实账号、服务配置值或完整对话。

## S01：AI 与邮件服务配置模块阶段文件

原文件：`service-settings-stage.js`；原行号：12—18。

<!-- prettier-ignore -->
```js
export const serviceSchemaSql=`CREATE TABLE IF NOT EXISTS platform_service_settings (
 kind VARCHAR(16) PRIMARY KEY, config_json JSON NOT NULL, encrypted_secret TEXT NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 1, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`;
export const serviceChecksSql=`CREATE TABLE IF NOT EXISTS platform_service_checks (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(16) NOT NULL, config_version INT UNSIGNED NOT NULL, status VARCHAR(16) NOT NULL, elapsed_ms INT UNSIGNED NULL, summary VARCHAR(300) NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME NULL, INDEX idx_service_check_kind(kind,id)
)`;
export class ServiceSettings {
```

## S05：学习助手改造前的前端入口快照

原文件：`main-before-assistant.jsx`；原行号：46—57。

<!-- prettier-ignore -->
```jsx
async function request(path, { token, method = 'GET', body, signal } = {}) {
  const response = await fetch(`${api}${path}`, {
    method, signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(data.message || '请求失败');
  return data;
}

```

## S06：独立对话模块阶段文件

原文件：`assistant-sessions.js`；原行号：13—21。

<!-- prettier-ignore -->
```js
export function parseAssistantAnswer(raw, sources=[]) {
  const tag = raw.indexOf('<followups>');
  const content = (tag < 0 ? raw.replace(/<f(?:o(?:l(?:l(?:o(?:w(?:u(?:p(?:s)?)?)?)?)?)?)?)?$/, '') : raw.slice(0,tag)).trim();
  let followups=[];
  if(tag>=0) try {followups=JSON.parse(raw.slice(tag+11).split('</followups>')[0]);} catch {}
  followups=Array.isArray(followups) ? [...new Set(followups.filter(s=>typeof s==='string' && s.trim() && s.length<=100))].slice(0,3) : [];
  const used = new Set([...content.matchAll(/\[资料(\d+)\]/g)].map(m=>Number(m[1])-1));
  return {content,sources:sources.filter((_,i)=>used.has(i)),followups};
}
```

## S07：学习助手工作区阶段文件

原文件：`AssistantWorkspace.jsx`；原行号：23—33。

<!-- prettier-ignore -->
```jsx
export default function AssistantWorkspace({token, courses, courseId, onCourse, question, onQuestion, model, onModel, availableModels, messages, asking, error, onAsk, onCourses, onOpenNotes, Answer}) {
  const [mode, setMode] = useState('outline');
  const input = useRef(null);
  const conversation = useRef(null);
  const follow = useRef(true);
  const activeCourse = courses.find(course => String(course.id) === courseId);
  useEffect(() => {follow.current = true;}, [courseId]);
  useEffect(() => {
    const list = conversation.current;
    if (list && follow.current) list.scrollTo({top:list.scrollHeight, behavior:'instant'});
  }, [messages.length, asking, courseId]);
```

## S09：间隔复习节奏模块阶段文件

原文件：`review-rhythm.mjs`；原行号：1—1。

<!-- prettier-ignore -->
```js
export const REVIEW_RHYTHM_DAYS = Object.freeze([1, 3, 7, 14, 30]);
```

## S10：统一管理弹窗组件阶段文件

原文件：`AdminDialog.jsx`；原行号：7—21。

<!-- prettier-ignore -->
```jsx
export default function AdminDialog({title,onClose,locked=false,dirty=false,className='',children}){
  const root=useRef(null),confirm=useRef(null),latest=useRef({});
  const [discard,setDiscard]=useState(false);
  const requestClose=()=>{if(locked)return;if(dirty){setDiscard(true);return;}onClose();};
  latest.current={locked,discard,requestClose};
  useEffect(()=>{
    const opener=document.activeElement;
    if(openCount++===0){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
    root.current?.focus();
    const keydown=event=>{
      const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>el.getClientRects().length);
      if(dialogs.at(-1)!==root.current)return;
      const state=latest.current;
      if(event.key==='Escape'){
        event.preventDefault();event.stopImmediatePropagation();
```
