import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { NotFound } from './components/NotFound';
import { PageBoundary } from './components/PageBoundary';
import { StaffGate, StaffProvider } from './components/StaffGate';
import { PageLoader, ToastProvider } from './components/ui';
import { Pages } from './lib/pages';

const { Board, Counter, Kiosk, Lab, Landing, Ops, Status } = Pages;

export default function App() {
  return (
    <ToastProvider>
      <StaffProvider>
        <Routes>
          {/* the public landing page has its own full-bleed layout; every app screen keeps the shared header */}
          <Route path="/" element={
            <PageBoundary>
              <Suspense fallback={<div className="min-h-screen bg-[#071A3D]" />}><Landing /></Suspense>
            </PageBoundary>
          } />
          <Route path="*" element={
            <Layout>
              <PageBoundary>
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/kiosk" element={<Kiosk />} />
                    <Route path="/counter" element={<StaffGate title="Counter console"><Counter /></StaffGate>} />
                    <Route path="/board" element={<Board />} />
                    <Route path="/status/:id" element={<Status />} />
                    <Route path="/ops" element={<StaffGate title="Supervisor ops" need="staff-stats"><Ops /></StaffGate>} />
                    <Route path="/lab" element={<Lab />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </PageBoundary>
            </Layout>
          } />
        </Routes>
      </StaffProvider>
    </ToastProvider>
  );
}
