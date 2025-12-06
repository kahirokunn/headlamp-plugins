import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { knativeRtkApi } from './api/knative';

export const knativeStore = configureStore({
  reducer: {
    [knativeRtkApi.reducerPath]: knativeRtkApi.reducer,
  },
  middleware: getDefaultMiddleware => getDefaultMiddleware().concat(knativeRtkApi.middleware),
});
setupListeners(knativeStore.dispatch);
