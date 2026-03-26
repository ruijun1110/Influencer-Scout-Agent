import { Outlet } from "react-router-dom"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TaskTracker } from "@/components/task-tracker"
import { useTasks } from "@/hooks/use-tasks"
import { useLanguage } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ListTodoIcon } from "lucide-react"

export function AppLayout() {
  const { batches, activeBatches } = useTasks()
  const { t } = useLanguage()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Sheet>
            <SheetTrigger className="relative inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9">
              <ListTodoIcon className="size-4" />
              {activeBatches.length > 0 && (
                <Badge className="absolute -top-1 -right-1 size-5 justify-center rounded-full p-0 text-[10px]">
                  {activeBatches.length}
                </Badge>
              )}
            </SheetTrigger>
            <SheetContent
              side="right"
              className="gap-0 overflow-hidden p-0 sm:max-w-sm"
            >
              <SheetHeader className="shrink-0 border-b">
                <SheetTitle>{t("tasks.title")}</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                <TaskTracker batches={batches} />
              </div>
            </SheetContent>
          </Sheet>
        </header>
        <main className="flex-1 overflow-auto bg-muted/20">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
      <Toaster position="top-center" />
    </SidebarProvider>
  )
}
