import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldOff, Mail, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getMemberSecurityStatus,
  resetMemberTwoFactor,
  sendMemberPasswordReset,
} from "@/lib/admin-recovery.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberUserId: string;
  memberName: string;
}

export function AdminRecoveryDialog({ open, onOpenChange, memberUserId, memberName }: Props) {
  const qc = useQueryClient();
  const getStatusFn = useServerFn(getMemberSecurityStatus);
  const resetFn = useServerFn(resetMemberTwoFactor);
  const resetPwFn = useServerFn(sendMemberPasswordReset);

  const [confirmReset, setConfirmReset] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmailChange, setConfirmEmailChange] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["member-security", memberUserId],
    queryFn: () => getStatusFn({ data: { memberUserId } }),
    enabled: open,
  });

  const resetM = useMutation({
    mutationFn: () => resetFn({ data: { memberUserId } }),
    onSuccess: () => {
      toast.success(`Reset all 2FA for ${memberName}. They can now sign in with just their password.`);
      qc.invalidateQueries({ queryKey: ["member-security", memberUserId] });
      setConfirmReset(false);
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmReset(false); },
  });

  const resetPwM = useMutation({
    mutationFn: (opts: { newEmail?: string }) =>
      resetPwFn({ data: { memberUserId, newEmail: opts.newEmail ?? null, origin: window.location.origin } }),
    onSuccess: (res: any) => {
      toast.success(`Password reset email sent to ${res.email}`);
      setNewEmail("");
      setConfirmEmailChange(false);
      qc.invalidateQueries({ queryKey: ["member-security", memberUserId] });
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmEmailChange(false); },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recover access for {memberName}</DialogTitle>
            <DialogDescription>
              Use these last-resort tools when a member has lost access to their email or authenticator and can't self-recover.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : status ? (
            <>
              {/* Security status */}
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Current security</div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={status.email2faEnabled ? "default" : "outline"} className="gap-1">
                    <Mail className="w-3 h-3" /> Email 2FA {status.email2faEnabled ? "on" : "off"}
                  </Badge>
                  <Badge variant={status.totpFactors > 0 ? "default" : "outline"} className="gap-1">
                    <ShieldCheck className="w-3 h-3" /> Authenticator {status.totpFactors > 0 ? "on" : "off"}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <KeyRound className="w-3 h-3" /> {status.recoveryCodesRemaining}/{status.recoveryCodesTotal} recovery codes
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Email: {status.email}
                  {status.lastSignInAt && <> · Last signed in {new Date(status.lastSignInAt).toLocaleString()}</>}
                </div>
              </div>

              <Separator />

              {/* Reset 2FA */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Reset all 2FA</div>
                    <div className="text-xs text-muted-foreground">
                      Turns off email 2FA, deletes the authenticator, and wipes recovery codes. The member can then sign in with just their password.
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmReset(true)}
                    className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <ShieldOff className="w-4 h-4 mr-1.5" /> Reset 2FA
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Send password reset */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Send password reset</div>
                <div className="text-xs text-muted-foreground">
                  Emails a set-a-new-password link. If the member has also lost their email inbox, enter a new address below — it replaces the account email (no confirmation needed) and the link goes there.
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor="newEmail" className="text-xs">New email (optional)</Label>
                    <Input
                      id="newEmail"
                      type="email"
                      placeholder={status.email ?? "name@company.com"}
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resetPwM.isPending}
                    onClick={() => {
                      if (newEmail.trim() && newEmail.trim().toLowerCase() !== (status.email ?? "").toLowerCase()) {
                        setConfirmEmailChange(true);
                      } else {
                        resetPwM.mutate({});
                      }
                    }}
                  >
                    <Mail className="w-4 h-4 mr-1.5" />
                    {resetPwM.isPending ? "Sending…" : newEmail.trim() ? "Change email & send" : "Send reset"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all 2FA for {memberName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This turns off email 2FA, deletes their authenticator, and wipes their recovery codes. They'll be able to sign in with just their password until they re-enroll 2FA. This is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetM.isPending}
              onClick={() => resetM.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetM.isPending ? "Resetting…" : "Reset 2FA"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmailChange} onOpenChange={setConfirmEmailChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change email to {newEmail.trim()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces {memberName}'s account email — they'll sign in with the new address from now on. A password reset link will be sent to the new email. This is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPwM.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPwM.isPending}
              onClick={() => resetPwM.mutate({ newEmail: newEmail.trim() })}
            >
              {resetPwM.isPending ? "Applying…" : "Change email & send reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
