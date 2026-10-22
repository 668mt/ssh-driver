/**
 * 后端内部类型 —— REST 层与 store 层的合约
 * @Author Martin
 * @Date 2026/10/19
 */

import { HostConfig } from '../config/schema';

export type CreateHostBody = Omit<HostConfig, 'createdAt' | 'updatedAt'>;
export type UpdateHostBody = Partial<CreateHostBody>;

export interface ApiError {
  error: string;
}
