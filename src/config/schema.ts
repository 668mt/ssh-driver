/**
 * SSH 连接配置的数据契约
 * @Author Martin
 * @Date 2026/10/19
 */

/** 单个保存的 SSH 主机 */
export interface HostConfig {
  /** 唯一 id（dbId 风格），用于命令行引用 */
  hostId: string;
  /** 人类可读描述，便于区分多套环境 */
  description?: string;
  /** 主机名或 IP */
  host: string;
  /** 端口，默认 22 */
  port?: number;
  /** 用户名 */
  username: string;
  /** 密码（与 privateKey 二选一） */
  password?: string;
  /** 私钥文件绝对路径（推荐，优先级高于 password） */
  privateKey?: string;
  /** 私钥口令（如果私钥加密了） */
  passphrase?: string;
  /** 主机密钥指纹（如 sha256:xxxx），配置后强制校验，防中间人 */
  hostHash?: string;
  /** 连接超时（毫秒），默认 15000 */
  readyTimeout?: number;
  /** 标签，便于分组 */
  tags?: string[];
  /** 创建/更新时间（ISO） */
  createdAt?: string;
  updatedAt?: string;
}

/** 持久化的根结构 */
export interface StoreFile {
  version: 1;
  hosts: HostConfig[];
}

export const STORE_VERSION = 1 as const;

/** 对外暴露时**不**做任何掩码——本地明文存，前端要能直接看到原值 */
export function plainView<T extends HostConfig | HostConfig[]>(h: T): T {
  // 故意保留为 identity：当前已经明文存储，掩盖只会让编辑体验差、不挡什么安全
  return h;
}

/**
 * 备份友好视图：把敏感字段抹成 *** 占位符，避免落到磁盘 / Git / 移动设备。
 * 只用于 import/export 场景。
 */
export function backupView<T extends HostConfig | HostConfig[]>(h: T): T {
  const mask = (x: HostConfig): HostConfig => ({
    ...x,
    password: x.password ? '***' : undefined,
    privateKey: x.privateKey ? '***' : undefined,
    passphrase: x.passphrase ? '***' : undefined,
  });
  return (Array.isArray(h) ? h.map(mask) : mask(h)) as T;
}

/**
 * 向后兼容：早期叫 publicView、现在语义已变化，仍保留别名指向 plainView，
 * 这样老的 import 不会被 TS 报红。
 * @deprecated 用 plainView 或 backupView 替代
 */
export const publicView = plainView;
