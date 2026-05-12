import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Onboarding from './components/Onboarding'
import AnnotationReview from './components/AnnotationReview'
import SessionView from './components/SessionView'
import SessionReport from './components/SessionReport'

// Layout wrapper for consistent bg + page transitions
function PageWrapper({ children }) {
  return (
    <div className="page-enter min-h-screen">
      {children}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/"
          element={<PageWrapper><Onboarding /></PageWrapper>}
        />
        <Route
          path="/review/:sessionId"
          element={<PageWrapper><AnnotationReview /></PageWrapper>}
        />
        <Route
          path="/session/:sessionId"
          element={<PageWrapper><SessionView /></PageWrapper>}
        />
        <Route
          path="/report/:sessionId"
          element={<PageWrapper><SessionReport /></PageWrapper>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
