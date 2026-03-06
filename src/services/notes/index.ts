import { get, post, put, del } from '../request';
import type {
  NotesRequest,
  NotesResponse,
  NoteItem,
  CreateNoteRequest,
  UpdateNoteRequest,
  DeleteNoteRequest,
  TodoListResponse,
  TodolistRequest,
  CreateTodoRequest,
  CreateTodoResponse,
  UpdateTodoRequest,
  UpdateTodoResponse,
  DeleteTodoRequest,
  DeleteTodoResponse,
  UpdateTodoTaskRequest,
  UpdateTodoTaskResponse,
} from './types';
import type { ResponseType } from '../request';
//获取笔记列表数据
export const getNotes = (params: NotesRequest): Promise<ResponseType<NotesResponse>> => {
  return get('/api/sensetype/notes', { ...params });
};
//创建笔记数据
export const createNote = (params: CreateNoteRequest): Promise<ResponseType<NoteItem>> => {
  return post('/api/sensetype/note', { ...params });
};
//更新笔记数据
export const updateNote = (params: UpdateNoteRequest): Promise<ResponseType<NoteItem>> => {
  const { id, ...data } = params;
  return put('/api/sensetype/note/' + id, data);
};
//删除笔记数据
export const deleteNote = (params: DeleteNoteRequest): Promise<ResponseType<NoteItem>> => {
  return del('/api/sensetype/note/' + params.id);
};
//获取待办事项列表
export const getTodoList = (params: TodolistRequest): Promise<ResponseType<TodoListResponse>> => {
  return get('/api/sensetype/todos', { ...params });
};
//创建待办事项
export const createTodo = (
  params: CreateTodoRequest,
): Promise<ResponseType<CreateTodoResponse>> => {
  return post('/api/sensetype/todo', { ...params });
};
//更新待办事项组数据
export const updateTodo = (
  params: UpdateTodoRequest,
): Promise<ResponseType<UpdateTodoResponse>> => {
  const { id, ...data } = params;
  return put('/api/sensetype/todo/' + id, data);
};
//删除待办事项组数据
export const deleteTodo = (
  params: DeleteTodoRequest,
): Promise<ResponseType<DeleteTodoResponse>> => {
  return del('/api/sensetype/todo/' + params.id);
};
//更新待办任务单条数据
export const updateTodoTask = (
  params: UpdateTodoTaskRequest,
): Promise<ResponseType<UpdateTodoTaskResponse>> => {
  const { id, ...data } = params;
  return put('/api/sensetype/todo/task/' + id, data);
};
