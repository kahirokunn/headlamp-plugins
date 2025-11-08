/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { addIcon } from '@iconify/react';
import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import HttpRouteDetails from './components/HttpRouteDetails';
import HttpRoutesList from './components/HttpRoutesList';

// Register custom icon for Envoy Gateway
addIcon('custom:envoy-gateway', {
  body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 600 400">
  <g>
    <g id="Layer_1" transform="translate(50, 0)">
      <g>
        <polygon id="polygon20" class="cls-2" points="191.2 242.29 190.55 213 159.76 193.83 160.4 223.12 191.2 242.29"/>
        <path fill="currentColor" id="path22" class="cls-2" d="M234.92,315.52l-.65-28.65-26.92-16.8c-.43-.21-.86-.64-1.08-.86l.65,28.86,28,17.45h0Z"/>
        <path fill="currentColor" id="path24" class="cls-2" d="M138.65,354.07l-70.42-43.72-1.73-73.23,34.46-14.86-.65-29.29-55.14,23.69c-4.3,1.94-6.89,5.81-6.67,10.33l2.15,87.87c0,4.53,2.8,9.06,7.11,11.64l84.43,52.33c3.88,2.37,8.61,3.02,12.71,1.94.43-.21.86-.21,1.29-.43l51.9-22.39-28.21-17.45-31.23,13.57h0Z"/>
        <path fill="currentColor" id="path26" class="cls-2" d="M366.29,192.11c-.21-5.17-3.23-10.55-8.39-13.57l-102.52-63.53-3.23,1.29.64,30.8,81.19,50.4,1.94,82.27,31.01,19.17,1.72-.64-2.37-106.18h0Z"/>
        <path fill="currentColor" id="path28" class="cls-2" d="M243.53,336.62l-95.41-59.01-2.37-99.07,43.51-18.74-.86-34.24-67.41,29.07c-4.95,2.16-7.97,6.68-7.75,12.06l2.8,116.3c0,5.38,3.23,10.56,8.4,13.57l111.78,69.35c4.52,2.79,10.12,3.66,14.86,2.15.43-.22.86-.43,1.29-.43l65.9-28.44-32.73-20.25-42,17.67h0Z"/>
        <path fill="currentColor" id="path30" class="cls-2" d="M511.67,110.69L368.45,21.96c-5.38-3.23-11.62-4.1-17-2.37-.44.21-1.08.43-1.51.64l-139.78,60.31c-5.6,2.37-9.04,7.54-8.83,13.78l3.44,149.04c.22,6.03,3.88,12.06,9.7,15.51l143.22,88.73c5.17,3.23,11.63,4.09,17.01,2.38.43-.22,1.08-.44,1.51-.65l139.78-60.3c5.59-2.37,9.05-7.75,8.84-13.79l-3.45-149.04c-.21-6.03-3.88-11.85-9.69-15.51M366.08,314.22l-124.48-77.11-3.02-129.44,121.47-52.33,124.49,77.1,3.02,129.45-121.47,52.33h0Z"/>
      </g>
    </g>
  </g>
</svg>`,
  width: 24,
  height: 24,
});

// Sidebar root (parent)
registerSidebarEntry({
  name: 'envoy-gateway',
  url: '/plugins/envoy-gateway/httproutes',
  parent: '',
  label: 'Envoy Gateway',
  icon: 'custom:envoy-gateway',
});

// Sidebar child - HTTPRoutes
registerSidebarEntry({
  parent: 'envoy-gateway',
  name: 'eg-httproutes',
  label: 'HTTPRoutes',
  url: '/plugins/envoy-gateway/httproutes',
});

// List/Landing route
registerRoute({
  path: '/plugins/envoy-gateway/httproutes',
  sidebar: 'eg-httproutes',
  name: 'eg-HTTPRoutes',
  exact: true,
  component: HttpRoutesList,
});

// Detail route (HTTPRoute)
registerRoute({
  path: '/plugins/envoy-gateway/httproutes/:namespace/:name',
  sidebar: 'eg-httproutes',
  name: 'HTTPRoute',
  component: HttpRouteDetails,
});
