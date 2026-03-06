import { LOCAL_CONFIG_KEY } from '../../../main/browsers/config';

const localConfig = {
  getConfig(): Promise<any> {
    const data: any = window.sensetype.db.get(LOCAL_CONFIG_KEY) || {};
    return data.data;
  },

  setConfig(data: any) {
    const localConfig: any = window.sensetype.db.get(LOCAL_CONFIG_KEY) || {};
    window.sensetype.db.put({
      _id: LOCAL_CONFIG_KEY,
      _rev: localConfig._rev,
      data: {
        ...localConfig.data,
        ...data,
      },
    });
  },
};

export default localConfig;
