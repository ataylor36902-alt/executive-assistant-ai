import React from "react";

export const Button = ({ children }: { children: React.ReactNode }) => <button>{children}</button>;
export const Card = ({ children }: { children: React.ReactNode }) => <section>{children}</section>;
export const CardHeader = Card;
export const CardTitle = ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>;
export const CardContent = Card;
export const Link = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
export const BookOpen = () => null;
export const Loader2 = () => null;
export const useQueryClient = () => ({ setQueryData() {} });