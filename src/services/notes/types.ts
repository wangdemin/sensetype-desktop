// 笔记列表查询请求参数
export interface NotesRequest {
  page: number;
  size: number;
  status?: string;
  desc_by: string;
}

// 笔记列表查询响应
export interface NotesResponse {
  list: NoteItem[];
  total: number;
}

// 笔记条目
export interface NoteItem {
  id: string;
  content: string;
}

// 创建笔记请求参数
export interface CreateNoteRequest {
  content: string;
}

// 更新笔记请求参数
export interface UpdateNoteRequest {
  id: string;
  title?: string;
  status?: string;
  content: string;
}

// 删除笔记请求参数
export interface DeleteNoteRequest {
  id: string;
}

// 待办事项条目
export interface TodoItem {
  id: string;
  title?: string;
  tasks: TodoTaskDTO[];
  created_at: number;
  updated_at: number;
}

// 待办任务条目（服务端完整结构）
export interface TodoTaskDTO {
  id: string;
  todo: string;
  status: TodoTaskStatus; //待办任务状态 1 待完成 2 已完成
  deleted?: boolean;
}

// 获取待办事项列表响应
export interface TodoListResponse {
  list: TodoItem[];
  total: number;
}

// 待办任务条目（创建 payload）
export interface CreateTodoTaskPayload {
  id?: string;
  todo: string;
  status?: TodoTaskStatus;
}

export interface TodolistRequest {
  page: number;
  size: number;
  status?: string;
  desc_by?: string;
}
// 待办任务条目（更新 payload：新增/更新/删除）
// - 新增：仅传 todo（不传 id）
// - 更新：传 id + todo，并明确 deleted=false
// - 删除：传 id + deleted=true
export type UpdateTodoTaskPayload =
  | {
      id: string;
      deleted: true;
    }
  | {
      id: string;
      todo: string;
      status?: TodoTaskStatus;
      deleted?: false;
    }
  | {
      todo: string;
      status?: TodoTaskStatus;
      deleted?: false;
    };

// 创建待办事项请求参数
export interface CreateTodoRequest {
  title?: string;
  tasks: CreateTodoTaskPayload[];
}

// 创建待办事项响应
export type CreateTodoResponse = TodoItem;

// 更新待办事项请求参数
export interface UpdateTodoRequest {
  id: string;
  title?: string;
  delete?: string[];
  tasks: UpdateTodoTaskPayload[];
}

// 更新待办事项响应
export type UpdateTodoResponse = TodoItem;
// 删除待办事项请求参数
export interface DeleteTodoRequest {
  id: string;
}

// 删除待办事项响应
export interface DeleteTodoResponse {
  id: string;
}

//待办任务状态
export enum TodoTaskStatus {
  TODO = 1,
  COMPLETED = 2,
}

//更新待办任务请求参数
export interface UpdateTodoTaskRequest {
  id: string;
  status: TodoTaskStatus;
  todo: string;
}

//更新待办任务响应
export interface UpdateTodoTaskResponse {
  status: TodoTaskStatus;
  todo: string;
}
