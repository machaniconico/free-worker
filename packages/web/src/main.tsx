import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App.js';
import { HomePage } from './pages/HomePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { ChecklistPage } from './pages/ChecklistPage.js';
import { ProductsPage } from './pages/ProductsPage.js';
import { SalesPage } from './pages/SalesPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { BackupPage } from './pages/BackupPage.js';
import { DocumentsPage } from './pages/DocumentsPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { ContentPage } from './pages/ContentPage.js';
import { AuditPage } from './pages/AuditPage.js';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'checklist', element: <ChecklistPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'sales', element: <SalesPage /> },
      { path: 'expenses', element: <ExpensesPage /> },
      { path: 'backup', element: <BackupPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'content', element: <ContentPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root が見つかりません');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
