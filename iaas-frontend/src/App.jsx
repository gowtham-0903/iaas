import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import JDManagement from './pages/JDManagement'
import SkillExtraction from './pages/SkillExtraction'
import Candidates from './pages/Candidates'
import Clients from './pages/Clients'
import FeedbackForm from './pages/FeedbackForm'
import ScoreReport from './pages/ScoreReport'
import Users from './pages/Users'
import SkillExtractionHub from './pages/SkillExtractionHub'

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/jd" element={<JDManagement />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/feedback" element={<FeedbackForm />} />
          <Route path="/report" element={<ScoreReport />} />
          <Route path="/users" element={<Users />} />
        </Route>
        <Route path="/skill-extraction" element={<ProtectedRoute><SkillExtractionHub /></ProtectedRoute>} />
        <Route path="/skill-extraction/:jdId" element={<ProtectedRoute><SkillExtraction /></ProtectedRoute>} />
        <Route path="/jd-management" element={<Navigate to="/jd" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
