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
  /**
   * 是否被禁用。
   *
   * 禁用后该主机**只读**：不能连接、不能执行命令、不能读写文件。
   * 配置仍然保留，随时可以重新启用。用于「这台机器暂时别碰」。
   */
  disabled?: boolean;
  /** 创建/更新时间（ISO） */
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 主机被禁用时抛出的错误。
 *
 * 单独一个类型，是为了让调用方能区分「被禁用」和「连不上」——
 * 前者是策略问题（换个 host 或先启用），后者是技术问题。
 */
export class HostDisabledError extends Error {
  readonly code = 'HOST_DISABLED';

  constructor(hostId: string) {
    super(`主机 '${hostId}' 已被禁用，无法执行远程操作。请先启用该主机。`);
    this.name = 'HostDisabledError';
  }
}

/** 该主机是否处于禁用状态 */
export function isHostDisabled(host: Pick<HostConfig, 'disabled'>): boolean {
  return host.disabled === true;
}

/** 主机被禁用就抛错 —— 所有「要连上去干活」的地方都应先过这一关 */
export function assertHostEnabled(host: Pick<HostConfig, 'hostId' | 'disabled'>): void {
  if (isHostDisabled(host)) throw new HostDisabledError(host.hostId);
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
