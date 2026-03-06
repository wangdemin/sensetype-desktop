import Store from 'electron-store';

// 定义 store 的数据结构
interface StoreData {
  token: string | null;
  userInfo: any;
}

// 创建 electron-store 实例用于存储 token 和用户信息
const store = new Store<StoreData>({
  name: 'auth',
  defaults: {
    token: null,
    userInfo: null,
  },
});

export default store;
