import React from "react";

export const View = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
export const Text = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;
export const Pressable = ({ children }: { children: React.ReactNode }) => <button>{children}</button>;
export const ActivityIndicator = () => null;
export const Panel = View;
export const useRouter = () => ({ push() {} });
export const useQueryClient = () => ({ setQueryData() {} });
export const Stack = { Screen: () => null };
export const router = { push() {} };
export const useLocalSearchParams = () => ({ courseId: "course-id" });
export const Ionicons = () => null;
export const Share = { share() {} };
export const Btn = ({ title }: { title: string }) => <button>{title}</button>;
export const Card = View;
export const Empty = ({ text }: { text: string }) => <span>{text}</span>;
export const Md = ({ text }: { text: string }) => <span>{text}</span>;
export const Row = View;
export const Screen = View;
export const Section = View;
export const ExamFeatureAccessNotice = () => null;
export const useExamFeatureAccess = () => ({ allowed: true });
export const CreditsConfirmSheet = () => null;
export const isCreditsRequired = () => false;
export const refreshCreditsAfterAction = async () => ({ status: {} });
export const C = { accent: "#000", sec: "#555", blue: "#00f", ink: "#000", rec: "#f00", bg: "#fff", warnSoft: "#ff0" };
export const useStore = () => (globalThis as any).__studyGuideStore;
export const aiText = async () => "";
export const studyAI = async () => ({ text: "" });
export const errMsg = () => "";
export const getUid = () => "student";
export const health = async () => ({ ai: false });
export const localGuide = () => "";
export const material = () => "";
export const weakList = () => [];
export const daysUntil = () => 1;
export const fmtD = () => "Sep 24";
export const plural = (n: number, word: string) => `${n} ${word}`;
export const nowMs = () => 0;
export const useColors = () => ({
  foreground: "#000", mutedForeground: "#555", primary: "#000",
  primaryForeground: "#fff", destructive: "#f00", border: "#ddd",
});