// Loose ambient declarations for shadcn/ui .jsx components — they have no
// TS types and accept arbitrary props.
declare module "@/components/ui/*" {
  const component: any;
  export const Button: any;
  export const Input: any;
  export const Label: any;
  export const Textarea: any;
  export const Tabs: any;
  export const TabsContent: any;
  export const TabsList: any;
  export const TabsTrigger: any;
  export const Dialog: any;
  export const DialogContent: any;
  export const DialogFooter: any;
  export const DialogHeader: any;
  export const DialogTitle: any;
  export const DialogDescription: any;
  export const DialogTrigger: any;
  export const Sheet: any;
  export const SheetContent: any;
  export const SheetTrigger: any;
  export const Avatar: any;
  export const AvatarFallback: any;
  export const AvatarImage: any;
  export const DropdownMenu: any;
  export const DropdownMenuContent: any;
  export const DropdownMenuItem: any;
  export const DropdownMenuLabel: any;
  export const DropdownMenuSeparator: any;
  export const DropdownMenuTrigger: any;
  export const AlertDialog: any;
  export const AlertDialogAction: any;
  export const AlertDialogCancel: any;
  export const AlertDialogContent: any;
  export const AlertDialogDescription: any;
  export const AlertDialogFooter: any;
  export const AlertDialogHeader: any;
  export const AlertDialogTitle: any;
  export const AlertDialogTrigger: any;
  export const Toaster: any;
  export default component;
}

declare module "@/lib/utils" {
  export const cn: (...inputs: any[]) => string;
}
