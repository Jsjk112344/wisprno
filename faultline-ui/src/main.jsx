import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './hero.jsx';
import Demo from './demo.jsx';
import {useRoute} from './navigation.jsx';
function Router(){const route=useRoute();return route==='/demo'||route.startsWith('/demo/')?<Demo/>:<App/>;}
createRoot(document.getElementById('root')).render(<Router/>);
