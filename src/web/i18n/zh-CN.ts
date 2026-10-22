/**
 * 中文文案集中地
 * @Author Martin
 * @Date 2026/10/21
 */

export interface Strings {
  // 侧边栏
  appTitle: string;
  tabHosts: string;
  tabImportExport: string;

  // 公共
  save: string;
  cancel: string;
  create: string;
  confirm: string;
  delete: string;
  edit: string;
  remove: string;
  refresh: string;
  test: string;
  testing: string;
  saving: string;
  working: string;
  showPassword: string;
  hidePassword: string;

  // 顶栏
  healthLoading: string;
  healthOk: string;
  healthDown: string;
  configPath: string;

  // Hosts 页
  sectionHosts: string;
  emptyHosts: string;
  searchPlaceholder: string;
  newHost: string;
  confirmRemove: (id: string) => string;
  removedOk: (id: string) => string;
  removedFail: (id: string) => string;
  testOkMsg: (id: string, banner: string) => string;
  testFailMsg: (id: string, err: string) => string;
  fetchListFail: (err: string) => string;
  saveOk: (id: string) => string;

  // HostForm
  formNewTitle: string;
  formEditTitle: (id: string) => string;
  formRenamedHint: string;

  fieldHostId: string;
  fieldHostIdRequired: string;
  fieldDescription: string;
  fieldHost: string;
  fieldPort: string;
  fieldUsername: string;
  fieldReadyTimeout: string;
  fieldPassword: string;
  fieldPrivateKey: string;
  fieldPassphrase: string;
  fieldTags: string;
  fieldTagsPh: string;

  phHostId: string;
  phHost: string;
  phPrivateKey: string;
  phPassword: string;

  // Import/Export
  sectionIO: string;
  exportTitle: string;
  exportDesc: string;
  exportDownload: string;
  importTitle: string;
  importDesc: string;
  importPlaceholder: string;
  importModeReplace: string;
  importModeMerge: string;
  importRun: string;
  importInvalidJson: (msg: string) => string;
  importOk: (n: number, total: number, mode: string) => string;
}

const zhCN: Strings = {
  appTitle: 'ssh-driver',
  tabHosts: '主机列表',
  tabImportExport: '导入 / 导出',

  save: '保存',
  cancel: '取消',
  create: '创建',
  confirm: '确定',
  delete: '删除',
  edit: '编辑',
  remove: '删除',
  refresh: '刷新',
  test: '测试',
  testing: '测试中…',
  saving: '保存中…',
  working: '处理中…',
  showPassword: '显示',
  hidePassword: '隐藏',

  healthLoading: '后端检测中…',
  healthOk: '🟢 后端在线',
  healthDown: '🔴 后端不可用',
  configPath: '配置路径',

  sectionHosts: '已保存的主机',
  emptyHosts: '暂无主机，点击“新增主机”开始添加。',
  searchPlaceholder: '按 hostId / 主机 / 用户 / 标签 过滤…',
  newHost: '+ 新增主机',
  confirmRemove: (id) => `确认删除主机 “${id}”？此操作不可恢复。`,
  removedOk: (id) => `已删除 ${id}`,
  removedFail: (id) => `删除 ${id} 失败`,
  testOkMsg: (id, banner) => `${id} 连通 · ${banner}`,
  testFailMsg: (id, err) => `${id} 不通 · ${err}`,
  fetchListFail: (err) => `读取主机列表失败 · ${err}`,
  saveOk: (id) => `已保存 ${id}`,

  formNewTitle: '新增主机',
  formEditTitle: (id) => `编辑 · ${id}`,
  formRenamedHint:
    '你修改了 hostId，会触发重命名。如果新 hostId 已存在，请求会失败，请改名后重试。',

  fieldHostId: 'hostId',
  fieldHostIdRequired: '唯一标识',
  fieldDescription: '描述',
  fieldHost: '主机 / IP',
  fieldPort: '端口',
  fieldUsername: '用户名',
  fieldReadyTimeout: '连接超时(毫秒)',
  fieldPassword: '密码 (不建议生产使用)',
  fieldPrivateKey: '私钥路径',
  fieldPassphrase: '私钥口令 (可选)',
  fieldTags: '标签 (英文逗号分隔)',
  fieldTagsPh: 'prod, web',

  phHostId: 'prod-web-01',
  phHost: '10.0.1.10',
  phPrivateKey: '/home/me/.ssh/id_ed25519',
  phPassword: '••••••••',

  sectionIO: '导入 / 导出',
  exportTitle: '导出配置',
  exportDesc:
    '下载当前所有主机配置到 ssh-driver-config.json。敏感字段(密码 / 私钥 / 口令)在导出文件中以 "***" 占位；占位符不会被重新导入到系统中。',
  exportDownload: '下载 config.json',
  importTitle: '导入配置',
  importDesc:
    '将一份导出的 JSON 粘贴到下方文本框，选择替换当前配置还是合并。\n合并策略：按 hostId 去重，新条目覆盖旧条目；不存在的追加。',
  importPlaceholder: '{"version": 1, "hosts": [...]}',
  importModeReplace: '替换 (replace)',
  importModeMerge: '合并 (merge)',
  importRun: '导入',
  importInvalidJson: (msg) => `JSON 解析失败 · ${msg}`,
  importOk: (n, total, mode) => `导入完成 · 新增 ${n} 条，当前共 ${total} 条 · 模式 ${mode}`,
};

export default zhCN;
