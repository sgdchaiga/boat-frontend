import { toast } from "../../ui/use-toast";

interface ValidateCheckoutArgs {
  readOnly: boolean;
  hasActiveSession: boolean;
  cartCount: number;
  paymentLineCount: number;
}

export function validateCheckout(args: ValidateCheckoutArgs) {
  if (args.readOnly) {
    toast({ title: "Read only mode", description: "Subscription inactive: Retail POS is read-only." });
    return false;
  }
  if (!args.hasActiveSession) {
    toast({ title: "No active shift", description: "Open a cashier session first." });
    return false;
  }
  if (args.cartCount === 0) {
    toast({ title: "Cart is empty", description: "Scan or add at least one item." });
    return false;
  }
  if (args.paymentLineCount === 0) {
    toast({ title: "No tender lines", description: "Add at least one payment line." });
    return false;
  }
  return true;
}
