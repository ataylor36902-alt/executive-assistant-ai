import React from "react";
import { state } from "./syllabus-client";

export const Button = ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>;
export const Input = (props: React.ComponentProps<"input">) => <input {...props} />;
export const Textarea = (props: React.ComponentProps<"textarea">) => <textarea {...props} />;
export const useToast = () => ({ toast: (message: any) => state.toasts.push(message) });
export const FileUp = () => null;
export const FileText = FileUp;
export const Download = FileUp;
export const Loader2 = FileUp;
export const CheckSquare = FileUp;
export const Square = FileUp;
export const Save = FileUp;
export const CheckCircle2 = FileUp;
export const Circle = FileUp;
