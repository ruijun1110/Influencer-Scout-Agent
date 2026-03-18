import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/lib/i18n"
import { useAuth } from "@/hooks/use-auth"
import { AppLayout } from "@/components/app-layout"
import LoginPage from "@/pages/login"
import SetPasswordPage from "@/pages/set-password"
import HomePage from "@/pages/home"
import CampaignPage from "@/pages/campaign"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, needsPasswordSet } = useAuth()
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading...
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (needsPasswordSet) return <Navigate to="/set-password" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <I18nProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="campaign/:id/*" element={<CampaignPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </I18nProvider>
  )
}
