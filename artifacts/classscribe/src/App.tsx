import { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Eye, EyeOff } from "lucide-react";
import { Switch, Route, Redirect, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import Courses from "@/pages/Courses";
import CourseDetail from "@/pages/CourseDetail";
import LectureDetail from "@/pages/LectureDetail";
import RecordLecture from "@/pages/RecordLecture";
import AskClassScribe from "@/pages/AskClassScribe";
import AskSourceDetail from "@/pages/AskSourceDetail";
import ExamCenter from "@/pages/ExamCenter";
import Classmates from "@/pages/Classmates";
import Plans from "@/pages/Plans";
import SubscriptionPlans from "@/pages/SubscriptionPlans";
import Privacy from "@/pages/Privacy";
import Account from "@/pages/Account";
import Schedule from "@/pages/Schedule";

import RootLayout from "@/components/layout/RootLayout";
import PasswordResetPage from "@/components/auth/PasswordResetPage";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
  },
  variables: {
    colorPrimary: "hsl(235 65% 35%)",
    colorForeground: "hsl(240 40% 15%)",
    colorMutedForeground: "hsl(240 10% 45%)",
    colorDanger: "hsl(0 70% 50%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(240 40% 15%)",
    colorNeutral: "hsl(35 15% 90%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl shadow-lg border border-border w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-serif font-bold text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-sm font-medium text-foreground",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground text-xs",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-600",
    alertText: "text-destructive",
    logoBox: "flex items-center justify-center mb-4",
    socialButtonsBlockButton: "border-border hover:bg-muted/50",
    formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground font-medium",
    formFieldInput: "border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-md h-10",
    footerAction: "bg-muted/30 pb-6",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/20 text-destructive",
    otpCodeFieldInput: "border-border focus:border-primary focus:ring-1 focus:ring-primary",
    formFieldRow: "mb-4",
  },
};

function SignInPage() {
  const [, setLocation] = useLocation();
  const search = new URLSearchParams(useSearch());
  const formRef = useRef<HTMLDivElement>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const embedded = (() => {
    try { return window.top !== window.self; }
    catch { return true; }
  })();

  function openReset() {
    const field = formRef.current?.querySelector<HTMLInputElement>(
      'input[name="identifier"], input[name="emailAddress"], input[type="email"]',
    );
    const typedEmail = field?.value?.trim();
    setLocation(`/reset-password${typedEmail ? `?email=${encodeURIComponent(typedEmail)}` : ""}`);
  }

  function togglePasswordVisibility() {
    const next = !passwordVisible;
    setPasswordVisible(next);
    formRef.current?.querySelectorAll<HTMLInputElement>('input[type="password"], input[type="text"][data-clerk-password-visible="true"]').forEach((input) => {
      if (next) {
        input.dataset.clerkPasswordVisible = "true";
        input.type = "text";
      } else {
        delete input.dataset.clerkPasswordVisible;
        input.type = "password";
      }
    });
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div ref={formRef} className="w-full max-w-[440px]">
        {embedded ? (
          <div className="rounded-xl border border-border bg-white p-6 text-center">
            <h1 className="text-2xl font-bold">Open sign-in in a new tab</h1>
            <p className="mt-3 text-muted-foreground">Apple sign-in can’t complete inside the Replit preview frame. Open this sign-in page in a top-level tab to continue securely.</p>
            <a className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground" href={`${window.location.pathname}${window.location.search}`} target="_blank" rel="noopener">Open sign-in in a new tab</a>
          </div>
        ) : (
          <>
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
              initialValues={{ emailAddress: search.get("email") || "" }}
            />
            <div className="mx-auto mt-3 flex w-full max-w-[400px] flex-col items-end gap-3 px-2 text-sm">
              <button type="button" onClick={openReset} className="font-semibold text-primary hover:underline" data-testid="link-forgot-password">
                Forgot password?
              </button>
              <button type="button" onClick={togglePasswordVisibility} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground" aria-label={passwordVisible ? "Hide password" : "Show password"} data-testid="button-toggle-signin-password">
                {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {passwordVisible ? "Hide password" : "Show password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignUpPage() {
  const [, setLocation] = useLocation();
  const formRef = useRef<HTMLDivElement>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);

  function togglePasswordVisibility() {
    const next = !passwordVisible;
    setPasswordVisible(next);
    formRef.current?.querySelectorAll<HTMLInputElement>('input[type="password"], input[type="text"][data-clerk-password-visible="true"]').forEach((input) => {
      if (next) {
        input.dataset.clerkPasswordVisible = "true";
        input.type = "text";
      } else {
        delete input.dataset.clerkPasswordVisible;
        input.type = "password";
      }
    });
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div ref={formRef} className="w-full max-w-[440px]">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          forceRedirectUrl={`${basePath}/plans?onboarding=1`}
        />
        <div className="mx-auto mt-3 flex w-full max-w-[400px] flex-col items-end gap-3 px-2 text-sm">
          <button type="button" onClick={() => {
            const email = formRef.current?.querySelector<HTMLInputElement>('input[name="identifier"], input[name="emailAddress"], input[type="email"]')?.value?.trim();
            setLocation(`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ""}`);
          }} className="font-semibold text-primary hover:underline" data-testid="link-forgot-password">
            Forgot your password? Reset it
          </button>
          <button type="button" onClick={togglePasswordVisibility} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground" aria-label={passwordVisible ? "Hide password" : "Show password"} data-testid="button-toggle-signup-password">
            {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {passwordVisible ? "Hide password" : "Show password"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <RootLayout>
          <Component />
        </RootLayout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/reset-password" component={PasswordResetPage} />
      
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/courses" component={() => <ProtectedRoute component={Courses} />} />
      <Route path="/schedule" component={() => <ProtectedRoute component={Schedule} />} />
      <Route path="/courses/:id" component={() => <ProtectedRoute component={CourseDetail} />} />
      <Route path="/lectures/:id" component={() => <ProtectedRoute component={LectureDetail} />} />
      <Route path="/record" component={() => <ProtectedRoute component={RecordLecture} />} />
      <Route path="/ask" component={() => <ProtectedRoute component={AskClassScribe} />} />
      <Route path="/ask/source/:kind/:id" component={() => <ProtectedRoute component={AskSourceDetail} />} />
      <Route path="/exam-center" component={() => <ProtectedRoute component={ExamCenter} />} />
      <Route path="/classmates" component={() => <ProtectedRoute component={Classmates} />} />
      <Route path="/plans" component={() => <ProtectedRoute component={SubscriptionPlans} />} />
      <Route path="/study-plans" component={() => <ProtectedRoute component={Plans} />} />
      <Route path="/privacy" component={() => <ProtectedRoute component={Privacy} />} />
      <Route path="/account" component={() => <ProtectedRoute component={Account} />} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome to ClassScribe",
            subtitle: "Sign in to access your courses",
          },
        },
        signUp: {
          start: {
            title: "Create an account",
            subtitle: "Start building your academic memory",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <RoutedErrorBoundary>
          <Router />
        </RoutedErrorBoundary>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
