export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  groupTitle?: string;
  groupId?: string;
};

export type TodoGroup = {
  groupId: string;
  groupTitle?: string;
  items: TodoItem[];
  createdAt: number;
};

export type DraftItem = {
  id: string;
  text: string;
  done: boolean;
};
