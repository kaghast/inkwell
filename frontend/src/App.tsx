import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import NoteDetail from "@/pages/NoteDetail";
import Settings from "@/pages/Settings";
import Graph from "@/pages/Graph";
import { AreasProvider } from "@/contexts/AreasContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ReminderScheduler from "@/components/ReminderScheduler";
import { useAuth } from "@/contexts/AuthContext";

function GlobalReminders() {
  const { user } = useAuth();
  if (!user || !(user as any).user_id) return null;
  return <ReminderScheduler />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/day/:date" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/tag/:name" element={<ProtectedRoute><Dashboard mode="tag" /></ProtectedRoute>} />
      <Route path="/person/:name" element={<ProtectedRoute><Dashboard mode="person" /></ProtectedRoute>} />
      <Route path="/location/:id" element={<ProtectedRoute><Dashboard mode="location" /></ProtectedRoute>} />
      <Route path="/area/:id" element={<ProtectedRoute><Dashboard mode="area" /></ProtectedRoute>} />
      <Route path="/note/:id" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/graph" element={<ProtectedRoute><Graph /></ProtectedRoute>} />
      <Route path="/graph/area/:id" element={<ProtectedRoute><Graph /></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AreasProvider>
        <BrowserRouter>
          <AppRoutes />
          <GlobalReminders />
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
        </AreasProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
