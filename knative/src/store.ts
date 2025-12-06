import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { knativeRtkApi } from './api/knativeRtkApi';

export const knativeStore = configureStore({
  reducer: {
    [knativeRtkApi.reducerPath]: knativeRtkApi.reducer,
  },
  middleware: getDefaultMiddleware => getDefaultMiddleware().concat(knativeRtkApi.middleware),
});

type KnativeRootState = ReturnType<typeof knativeStore.getState>;
type KnativeAppDispatch = typeof knativeStore.dispatch;

setupListeners(knativeStore.dispatch);
