import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { 
  BookOpen, 
  Home, 
  Library, 
  LogOut, 
  Mic, 
  Menu,
  MessageSquare,
  FileText,
  Users,
  Calendar,
  Shield,
  GraduationCap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onNavigate?: () => void;
}

function NavItem({ href, icon: Icon, label, isActive, onNavigate }: NavItemProps) {
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center gap-3 px-3 py-2 rounded-md transition-colors ${
        isActive
          ? "bg-primary text-primary-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }`}
      data-testid={`nav-${label.toLowerCase()}`}
      aria-current={isActive ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();

  const navItems = [
    { href: "/dashboard", icon: Home, label: "Home" },
    { href: "/record", icon: Mic, label: "Record" },
    { href: "/ask", icon: MessageSquare, label: "Ask ClassScribe" },
    { href: "/exam-center", icon: FileText, label: "Exam Center" },
    { href: "/classmates", icon: Users, label: "Classmates" },
    { href: "/study-plans", icon: Calendar, label: "Study Plans" },
    { href: "/plans", icon: GraduationCap, label: "Plans" },
    { href: "/schedule", icon: Calendar, label: "Schedule" },
    { href: "/privacy", icon: Shield, label: "Privacy" },
    { href: "/courses", icon: Library, label: "Courses" },
    { href: "/account", icon: GraduationCap, label: "Account" },
  ];

  // The web app groups lecture notes under Courses, and study tools under Exam Center.
  const mobileNavItems = [
    { href: "/dashboard", icon: Home, label: "Home" },
    { href: "/courses", icon: Library, label: "Courses" },
    { href: "/record", icon: Mic, label: "Record" },
    { href: "/ask", icon: MessageSquare, label: "Ask" },
    { href: "/exam-center", icon: FileText, label: "Exams" },
  ];

  const isActiveRoute = (href: string) =>
    location === href || (href === "/courses" && location.startsWith("/courses/"));

  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-6">
        <div className="flex items-center gap-2 text-sidebar-primary-foreground font-serif text-2xl font-bold mb-8">
          <BookOpen className="w-6 h-6" />
          <span>ClassScribe</span>
        </div>
        
        <nav aria-label="All pages" className="space-y-1.5">
          {navItems.map((item) => (
            <NavItem 
              key={item.href} 
              href={item.href} 
              icon={item.icon} 
              label={item.label} 
              isActive={isActiveRoute(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      </div>

      <div className="mt-auto p-4">
        <div className="flex items-center gap-3 p-3 rounded-md bg-sidebar-accent/50 border border-sidebar-border">
          <Avatar className="w-9 h-9 border border-sidebar-border">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
              {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-sidebar-foreground/60 truncate">{user?.primaryEmailAddress?.emailAddress}</p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground shrink-0 h-8 w-8"
            onClick={() => signOut()}
            data-testid="button-signout"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] h-[100dvh] bg-background overflow-hidden pt-[env(safe-area-inset-top)] md:pb-[env(safe-area-inset-bottom)]">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 shrink-0 border-r border-sidebar-border">
          <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex shrink-0 items-center justify-between h-14 px-4 border-b border-border bg-card">
          <div className="flex items-center gap-2 font-serif text-lg font-bold tracking-tight text-primary">
            <BookOpen className="w-5 h-5" aria-hidden="true" />
            <span>ClassScribe</span>
          </div>
          
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 text-primary" data-testid="button-mobile-menu" aria-label="Open navigation menu" aria-expanded={mobileMenuOpen}>
                <Menu className="w-5 h-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 max-w-[calc(100vw-3rem)] p-0 border-r-0">
              <SidebarContent onNavigate={() => setMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>

        {/* Main Content */}
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>

        {/* Mobile destinations; secondary pages remain available from the menu. */}
        <nav
          aria-label="Primary navigation"
          className="md:hidden shrink-0 border-t border-border bg-card px-1 pt-2 pb-1.5 shadow-sm"
        >
          <div className="grid grid-cols-5 items-end">
            {mobileNavItems.map(({ href, icon: Icon, label }) => {
              const isActive = isActiveRoute(href);
              const isRecord = href === "/record";

              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`mobile-nav-${label.toLowerCase()}`}
                  className={`group flex min-w-0 flex-col items-center justify-end gap-0.5 rounded-lg py-0.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                    isRecord
                      ? "text-destructive"
                      : isActive
                        ? "font-semibold text-primary"
                        : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-active:scale-95 ${
                      isRecord
                        ? "rounded-full bg-destructive text-destructive-foreground shadow-sm"
                        : isActive
                          ? "bg-primary/10"
                          : "group-hover:bg-muted"
                    }`}
                  >
                    <Icon className={isRecord ? "h-[21px] w-[21px]" : "h-5 w-5"} strokeWidth={isRecord ? 2.5 : 2} aria-hidden="true" />
                  </span>
                  <span className="block w-full truncate text-[10px] leading-4 tracking-[-0.01em]">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
