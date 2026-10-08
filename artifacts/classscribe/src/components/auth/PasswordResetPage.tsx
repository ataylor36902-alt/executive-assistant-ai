import { useState } from "react";
import { useSignIn } from "@clerk/react";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { useLocation, useSearch } from "wouter";

type ResetFields = {
  email: string;
  code: string;
  password: string;
};

function clerkError(error: unknown): string {
  const value = error as {
    errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
    message?: string;
  };
  const detail = value?.errors?.[0];
  const message = detail?.longMessage || detail?.message || value?.message;
  if (!message) return "We couldn't complete that step. Please try again.";
  if (/expired|invalid.*code|code.*invalid/i.test(`${detail?.code || ""} ${message}`)) {
    return "That code is invalid or has expired. Check the latest email or send a new code.";
  }
  return message;
}

export default function PasswordResetPage() {
  const { signIn } = useSignIn();
  const [, setLocation] = useLocation();
  const search = new URLSearchParams(useSearch());
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<ResetFields>({
    defaultValues: { email: search.get("email") || "", code: "", password: "" },
  });

  async function sendCode({ email }: ResetFields) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reset = await signIn.reset();
      if (reset.error) throw reset.error;
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) throw created.error;
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) throw sent.error;
      setStep("code");
      setNotice("A password reset code was sent. Check your email.");
    } catch (reason) {
      setError(clerkError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode({ code }: ResetFields) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const verified = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (verified.error) throw verified.error;
      if (signIn.status !== "needs_new_password") {
        throw new Error("The reset code needs another verification step. Send a new code and try again.");
      }
      setStep("password");
    } catch (reason) {
      setError(clerkError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword({ password }: ResetFields) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const changed = await signIn.resetPasswordEmailCode.submitPassword({ password });
      if (changed.error) throw changed.error;
      if (signIn.status !== "complete") {
        throw new Error("Your password was changed, but this account needs another sign-in step. Return to sign in and use your new password.");
      }
      const finalized = await signIn.finalize();
      if (finalized.error) throw finalized.error;
      setLocation("/dashboard");
    } catch (reason) {
      setError(clerkError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) throw sent.error;
      form.setValue("code", "");
      setNotice("A new reset code was sent. Check your email.");
    } catch (reason) {
      setError(clerkError(reason));
    } finally {
      setBusy(false);
    }
  }

  const goBack = async () => {
    if (busy) return;
    await signIn.reset();
    const email = form.getValues("email").trim();
    setLocation(`/sign-in${email ? `?email=${encodeURIComponent(email)}` : ""}`);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <section className="w-full max-w-[440px] rounded-xl border border-border bg-white p-7 shadow-lg dark:bg-card">
        <a href={`${basePath}/`} className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <img src={`${basePath}/logo.svg`} alt="" className="h-8 w-8" />
          ClassScribe
        </a>
        <h1 className="font-serif text-2xl font-bold text-foreground">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {step === "email" && "Enter your account email address and we'll send you a reset code."}
          {step === "code" && `Enter the password reset code sent to ${form.getValues("email")}.`}
          {step === "password" && "Your email is verified. Choose a new password for your account."}
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={form.handleSubmit(step === "email" ? sendCode : step === "code" ? verifyCode : savePassword)}
        >
          {step === "email" && (
            <label className="block space-y-2 text-sm font-medium text-foreground">
              Email address
              <input
                {...form.register("email", { required: "Enter your email address." })}
                type="email"
                autoComplete="email"
                autoFocus
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                data-testid="input-reset-email"
              />
              {form.formState.errors.email && <span className="text-sm text-destructive">{form.formState.errors.email.message}</span>}
            </label>
          )}
          {step === "code" && (
            <label className="block space-y-2 text-sm font-medium text-foreground">
              Reset code
              <input
                {...form.register("code", { required: "Enter the reset code sent to your email." })}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                data-testid="input-reset-code"
              />
              {form.formState.errors.code && <span className="text-sm text-destructive">{form.formState.errors.code.message}</span>}
            </label>
          )}
          {step === "password" && (
            <label className="block space-y-2 text-sm font-medium text-foreground">
              New password
              <span className="relative block">
                <input
                  {...form.register("password", { required: "Enter a new password." })}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoFocus
                  className="h-10 w-full rounded-md border border-input bg-background px-3 pr-11 font-normal"
                  data-testid="input-reset-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-reset-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {form.formState.errors.password && <span className="text-sm text-destructive">{form.formState.errors.password.message}</span>}
            </label>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-reset-error">{error}</p>}
          {notice && <p role="status" className="rounded-md bg-primary/5 px-3 py-2 text-sm text-foreground" data-testid="status-reset-notice">{notice}</p>}
          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            data-testid="button-reset-submit"
          >
            {busy ? "Please wait…" : step === "email" ? "Send reset code" : step === "code" ? "Verify reset code" : "Save new password"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          {step === "code" && (
            <button type="button" disabled={busy} onClick={() => void resendCode()} className="font-medium text-primary hover:underline" data-testid="button-reset-resend">
              Send a new code
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void goBack()} className="font-medium text-primary hover:underline" data-testid="link-reset-back">
            Back to sign in
          </button>
        </div>
      </section>
    </main>
  );
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");