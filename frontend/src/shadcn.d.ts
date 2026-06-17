// Loose ambient declarations for JS/JSX modules (shadcn ui, hooks, utils).
// With allowJs: false these are resolved against the ambient declaration first,
// giving them `any` at the type level. Webpack still resolves at runtime.
declare module "@/components/ui/*";
declare module "@/hooks/*";
declare module "@/lib/utils";
declare module "@/constants/*";
