import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import QuickPostPage from './pages/QuickPostPage.jsx';
import TrackingPage from './pages/TrackingPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

// Route-level code splitting so /post bundle stays small!
const NgoPage = lazy(() => import('./pages/NgoPage.jsx'));
const ProviderPage = lazy(() => import('./pages/ProviderPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          Loading...
        </div>
      }>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/post" element={<QuickPostPage />} />
          <Route path="/s/:shopToken" element={<QuickPostPage />} />
          <Route path="/track/:itemToken" element={<TrackingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/ngo" element={<NgoPage />} />
          <Route path="/provider" element={<ProviderPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
