import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import NoteDetail from "@/pages/NoteDetail";
import ProtectedRoute from "@/components/ProtectedRoute";

function AppRoutes() {
  const location = useLocation();
  // Detect Emergent session_id in URL fragment synchronously to avoid race
  if (location.hash && location.hash.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/day/:date" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/tag/:name" element={<ProtectedRoute><Dashboard mode="tag" /></ProtectedRoute>} />
      <Route path="/person/:name" element={<ProtectedRoute><Dashboard mode="person" /></ProtectedRoute>} />
      <Route path="/location/:id" element={<ProtectedRoute><Dashboard mode="location" /></ProtectedRoute>} />
      <Route path="/note/:id" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "hsl(var(--popover))",
                color: "hsl(var(--popover-foreground))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 4,
                fontFamily: "'Manrope', sans-serif",
              },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
