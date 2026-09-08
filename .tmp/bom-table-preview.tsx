import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ManufacturingBomPage } from './bom-table-page';
createRoot(document.getElementById('root')!).render(<ManufacturingBomPage />);
