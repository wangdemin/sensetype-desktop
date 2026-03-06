import store from './store';

// electron-store 的类型在部分 TS 配置下可能无法正确继承 conf 的 get/set/delete 声明；
// 这里做一次性、最小范围的类型收敛，避免在业务代码里到处 (store as any)。
interface AuthStoreAccess {
  get(key: 'token'): string | null;
  get(key: 'userInfo'): any;
  set(key: 'token', value: string | null): void;
  set(key: 'userInfo', value: any): void;
  delete(key: 'token' | 'userInfo'): void;
}

const authStore = store as unknown as AuthStoreAccess;

let tokenCache: string | null = null;
let userInfoCache: any = null;

const loadFromStore = () => {
  try {
    tokenCache = authStore.get('token') ?? null;
    userInfoCache = authStore.get('userInfo') ?? null;
  } catch {
    tokenCache = null;
    userInfoCache = null;
  }
};

// 模块加载即同步一次，避免后续每次请求都读 store
loadFromStore();

export const getToken = () => tokenCache;
export const getUserInfo = () => userInfoCache;

export const setToken = (token: string) => {
  tokenCache = token;
  try {
    authStore.set('token', token);
  } catch {
    // ignore
  }
};

export const setUserInfo = (userInfo: any) => {
  userInfoCache = userInfo;
  try {
    authStore.set('userInfo', userInfo);
  } catch {
    // ignore
  }
};

export const clearAuth = () => {
  tokenCache = null;
  userInfoCache = null;
  try {
    authStore.delete('token');
    authStore.delete('userInfo');
  } catch {
    // ignore
  }
};

// 如果外部直接操作了 store（不推荐），可以用它强制刷新缓存
export const refreshAuthCache = () => {
  loadFromStore();
};
