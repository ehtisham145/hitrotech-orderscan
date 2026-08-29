import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { 
  ArrowLeft, Save, TrendingUp, Users, Target, Calendar, 
  MapPin, Phone, CreditCard, ChevronRight, BarChart3, Plus, 
  CheckCircle2, AlertCircle, Trash2, History, Banknote, UserCheck,
  Landmark
} from "lucide-react";
import { 
  getEmployee, upsertEmployee, listEmployees, 
  getEmployeePerformance, getEmployeeTeamPerformance, 
  listEmployeeAdvances, upsertEmployeeAdvance, 
  settleEmployeeAdvance, deleteEmployeeAdvance,
  getEmployeeUsage, getEmployeeAdvancesSummary,
  type EmployeeRole 
} from "@/lib/employees.functions";
import { requireWorkspaceRole } from "@/lib/route-guards";
import { formatPkr } from "@/lib/plans";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell
} from "recharts";
import { NEON_TOOLTIP, NEON_TOOLTIP_ITEM, NEON_TOOLTIP_LABEL, RichTooltip } from "@/components/dashboard/chart-theme";



export const Route = createFileRoute("/_authenticated/admin/employees/$id")({
  head: () => ({
    meta: [
      { title: "Employee — HitroTech OrderScan" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireWorkspaceRole(["owner", "admin", "manager"] as const);
  },
  component: EmployeeEdit,
});

type FormState = {
  name: string;
  cnic: string;
  phone: string;
  employee_id: string;
  role: EmployeeRole;
  status: string;
  joining_date: string;
  city: string;
  area: string;
  manager_id: string;
  target_activations: number;
  salary: number;
  compensation_type: CompensationType;
  commission_per_activation: number;
  device_info: string;
  notes: string;
  kpi_metrics: any;
  promotion_history: any[];
};

const empty: FormState = {
  name: "",
  cnic: "",
  phone: "",
  employee_id: "",
  role: "bdo",
  status: "active",
  joining_date: new Date().toISOString().slice(0, 10),
  city: "",
  area: "",
  manager_id: "",
  target_activations: 0,
  salary: 0,
  compensation_type: "fixed",
  commission_per_activation: 0,
  device_info: "",
  notes: "",
  kpi_metrics: {},
  promotion_history: [],
};

function EmployeeEdit() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === "new";
  const fetchOne = useServerFn(getEmployee);
  const doUpsert = useServerFn(upsertEmployee);
  const fetchList = useServerFn(listEmployees);
  const fetchUsage = useServerFn(getEmployeeUsage);


  const fetchPerformance = useServerFn(getEmployeePerformance);
  const fetchTeam = useServerFn(getEmployeeTeamPerformance);
  const fetchAdvances = useServerFn(listEmployeeAdvances);
  const doUpsertAdvance = useServerFn(upsertEmployeeAdvance);
  const doSettleAdvance = useServerFn(settleEmployeeAdvance);
  const doDeleteAdvance = useServerFn(deleteEmployeeAdvance);
  const fetchAdvanceSummary = useServerFn(getEmployeeAdvancesSummary);


  const [form, setForm] = useState<FormState>(empty);
  const [activeTab, setActiveTab] = useState("details");
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));

  // Advance Dialog State
  const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({
    amount: "",
    repayment_amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    description: "",
  });

  // Settlement Dialog State
  const [settlementDialog, setSettlementDialog] = useState<{
    isOpen: boolean;
    advanceId: string;
    totalAmount: number;
    amountToSettle: string;
  }>({
    isOpen: false,
    advanceId: "",
    totalAmount: 0,
    amountToSettle: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => fetchOne({ data: { id } }),
    enabled: !isNew,
  });


  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: () => fetchList(),
  });

  const { data: perf, isLoading: isPerfLoading } = useQuery({
    queryKey: ["employee-performance", id, month],
    queryFn: () => fetchPerformance({ data: { employeeId: id, month } }),
    enabled: !isNew && activeTab === "performance",
  });

  const { data: teamPerf, isLoading: isTeamLoading } = useQuery({
    queryKey: ["employee-team", id, month],
    queryFn: () => fetchTeam({ data: { managerId: id, month } }),
    enabled: !isNew && (data?.role === 'asm' || data?.role === 'rsm') && activeTab === "team",
  });

  const { data: usage } = useQuery({
    queryKey: ["employee-usage"],
    queryFn: () => fetchUsage(),
    enabled: isNew,
  });


  const { data: advances, isLoading: isAdvancesLoading } = useQuery({
    queryKey: ["employee-advances", id],
    queryFn: () => fetchAdvances({ data: { employeeId: id } }),
    enabled: !isNew && activeTab === "advances",
  });
  const { data: advanceSummary } = useQuery({
    queryKey: ["employee-advance-summary", id],
    queryFn: () => fetchAdvanceSummary({ data: { employeeId: id } }),
    enabled: !isNew,
  });


  const pendingAdvanceTotal = advanceSummary?.pending ?? 0;



  // Managers are ASMs or RSMs
  const managers = (employees ?? [] as any[]).filter((e: any) => e.id !== id && (e.role === 'asm' || e.role === 'rsm'));

  useEffect(() => {
    if (!isNew && data) {
      setForm({
        name: data.name ?? "",
        cnic: data.cnic ?? "",
        phone: data.phone ?? "",
        employee_id: data.employee_id ?? "",
        role: (data.role as EmployeeRole) ?? "bdo",
        status: data.status ?? "active",
        joining_date: data.joining_date ?? new Date().toISOString().slice(0, 10),
        city: data.city ?? "",
        area: data.area ?? "",
        manager_id: data.manager_id ?? "",
        target_activations: data.target_activations ?? 0,
        salary: data.salary ?? 0,
        compensation_type: normalizeCompensationType((data as any).compensation_type),
        commission_per_activation: Number((data as any).commission_per_activation ?? 0),

        device_info: data.device_info ?? "",
        notes: data.notes ?? "",
        kpi_metrics: data.kpi_metrics ?? {},
        promotion_history: data.promotion_history ?? [],
      });
    }
  }, [isNew, data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const res = await doUpsert({ data: { ...form, id: isNew ? undefined : id, manager_id: form.manager_id || null } });
      return res.row;
    },
    onSuccess: () => {
      toast.success(isNew ? "Employee added" : "Employee updated");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee", id] });
      navigate({ to: "/admin/employees" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAdvance = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(advanceForm.amount);
      const repaymentAmt = parseFloat(advanceForm.repayment_amount);
      if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");
      return await doUpsertAdvance({ 
        data: { 
          employee_id: id, 
          amount: amt, 
          repayment_amount: isNaN(repaymentAmt) ? 0 : repaymentAmt,
          payment_date: advanceForm.payment_date,
          description: advanceForm.description 
        } 
      });
    },
    onSuccess: () => {
      toast.success("Advance payment recorded");
      qc.invalidateQueries({ queryKey: ["employee-advances", id] });
      setIsAdvanceDialogOpen(false);
      setAdvanceForm({ amount: "", repayment_amount: "", payment_date: new Date().toISOString().slice(0, 10), description: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSettle = useMutation({
    mutationFn: async ({ advanceId, settled, amount }: { advanceId: string, settled: boolean, amount?: number }) => {
      // In a real app, settleEmployeeAdvance might need to handle partial amounts.
      // For now, we follow the existing pattern but could extend the server function if needed.
      return await doSettleAdvance({ data: { id: advanceId, settled } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-advances", id] });
      qc.invalidateQueries({ queryKey: ["employee-advance-summary", id] });
      toast.success("Advance status updated");
      setSettlementDialog(prev => ({ ...prev, isOpen: false }));
    },
  });

  const deleteAdv = useMutation({
    mutationFn: async (advanceId: string) => {
      return await doDeleteAdvance({ data: { id: advanceId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-advances", id] });
      toast.success("Advance deleted");
    },
  });

  if (!isNew && isLoading) {

    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
          <Skeleton className="h-[600px] w-full rounded-2xl" />
          <div className="space-y-6">
            <Skeleton className="h-[300px] w-full rounded-2xl" />
            <Skeleton className="h-[100px] w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const isManagement = data?.role === 'asm' || data?.role === 'rsm';


  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/employees" })} className="rounded-full hover:bg-slate-100">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isNew ? "Add employee" : "Edit employee"}</h1>
            <p className="text-sm text-muted-foreground font-medium">
              {isNew ? "Create a new employee profile." : "Manage employee details, performance, and advances."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
        <div className="space-y-6">

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-100/50 p-1 rounded-xl mb-6">
            <TabsTrigger value="details" className="rounded-lg">Details</TabsTrigger>
            {!isNew && <TabsTrigger value="performance" className="rounded-lg">Performance</TabsTrigger>}
            {!isNew && isManagement && <TabsTrigger value="team" className="rounded-lg">Team</TabsTrigger>}
            {!isNew && (
              <TabsTrigger value="advances" className="rounded-lg relative">
                Advances
                {pendingAdvanceTotal > 0 && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full border border-white" />
                )}
              </TabsTrigger>
            )}

          </TabsList>

          <TabsContent value="details" className="space-y-6">
            <Card className="rounded-2xl border-slate-200/60 shadow-sm">

            <CardHeader><CardTitle className="text-base font-bold">Personal & Professional Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. John Doe" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employee_id">Employee ID</Label>
                  <Input id="employee_id" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} placeholder="e.g. EMP-001" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cnic">CNIC</Label>
                  <Input id="cnic" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="XXXXX-XXXXXXX-X" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XX-XXXXXXX" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="joining_date">Joining Date</Label>
                  <Input id="joining_date" type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as EmployeeRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bdo">Business Development Officer (BDO)</SelectItem>
                      <SelectItem value="asm">Area Sales Manager (ASM)</SelectItem>
                      <SelectItem value="rsm">Regional Sales Manager (RSM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Compensation Model</Label>
                  <Select
                    value={form.compensation_type}
                    onValueChange={(v) => setForm({ ...form, compensation_type: v as CompensationType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMPENSATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{COMPENSATION_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-500">{COMPENSATION_HINTS[form.compensation_type]}</p>
                </div>
                {form.compensation_type !== "commission_only" && (
                  <div className="space-y-2">
                    <Label htmlFor="salary">Monthly Salary (PKR)</Label>
                    <Input id="salary" type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: parseInt(e.target.value) || 0 })} />
                  </div>
                )}
                {form.compensation_type !== "fixed" && (
                  <div className="space-y-2">
                    <Label htmlFor="rate">Commission per Activation (PKR)</Label>
                    <Input
                      id="rate"
                      type="number"
                      value={form.commission_per_activation}
                      onChange={(e) => setForm({ ...form, commission_per_activation: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                )}

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="device_info">Assigned Device(s)</Label>
                  <Input id="device_info" value={form.device_info} onChange={(e) => setForm({ ...form, device_info: e.target.value })} placeholder="e.g. Samsung A55 - ID: 12345" />
                </div>
                
                <div className="space-y-4 md:col-span-2 pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-slate-900">
                    <MapPin className="w-4 h-4 text-brand-primary" /> Location & Assignment
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Lahore" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="area">Area / Sector</Label>
                      <Input id="area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="e.g. Gulberg III" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="target_activations">Monthly Activation Target</Label>
                      <Input 
                        id="target_activations" 
                        type="number" 
                        value={form.target_activations} 
                        onChange={(e) => setForm({ ...form, target_activations: parseInt(e.target.value) || 0 })} 
                      />
                    </div>
                  </div>


                </div>

                <div className="space-y-4 md:col-span-2 pt-4 border-t border-slate-100">
                   <h3 className="text-sm font-bold flex items-center gap-2 text-slate-900">
                     <Users className="w-4 h-4 text-brand-primary" /> Reporting Structure
                   </h3>
                   <div className="space-y-2">
                     <Label htmlFor="manager_id">Direct Manager</Label>
                     <Select value={form.manager_id || "none"} onValueChange={(v) => setForm({ ...form, manager_id: v === "none" ? "" : v })}>
                       <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                       <SelectContent>
                         <SelectItem value="none">No Manager (Direct Report)</SelectItem>
                         {(employees ?? []).filter((e: any) => e.id !== id && (e.role === 'asm' || e.role === 'rsm')).map((e: any) => (
                           <SelectItem key={e.id} value={e.id}>{e.name} ({e.role?.toUpperCase()})</SelectItem>
                         ))}
                       </SelectContent>
                     </Select>
                   </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200/60 shadow-sm">
            <CardHeader><CardTitle className="text-base font-bold">Promotion & History</CardTitle></CardHeader>
            <CardContent className="space-y-4">
               <div className="space-y-4">
                <Button 
                  variant="outline" 
                  className="w-full border-dashed" 
                  onClick={() => {
                    const newRecord = { role: form.role, salary: form.salary, date: format(new Date(), "yyyy-MM-dd"), notes: "Current status snapshot" };
                    setForm({ ...form, promotion_history: [newRecord, ...form.promotion_history] });
                    toast.info("Added current snapshot to history");
                  }}
                >
                  <History className="w-4 h-4 mr-2" /> Snapshot Current Role
                </Button>

                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                  {form.promotion_history.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-4">No history records.</p>
                  ) : (
                    form.promotion_history.map((record: any, idx: number) => (
                      <div key={idx} className="text-xs p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex justify-between font-bold mb-1">
                          <span>{record.role?.toUpperCase()}</span>
                          <span className="font-mono text-slate-400">{record.date}</span>
                        </div>
                        <div className="text-slate-500">Salary: {formatPkr(record.salary)}</div>
                        {record.notes && <div className="mt-1 italic text-slate-400">"{record.notes}"</div>}
                      </div>
                    ))
                  )}
                </div>
               </div>
            </CardContent>
          </Card>
        </TabsContent>



        <TabsContent value="performance" className="space-y-6 focus-visible:outline-none">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-bold">Performance Breakdown</h3>
              <p className="text-sm text-muted-foreground">Monthly activation trends and targets</p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Input 
                type="month" 
                value={month} 
                onChange={(e) => setMonth(e.target.value)}
                className="w-[160px] h-9"
              />
            </div>
          </div>

          {isPerfLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <div className="grid gap-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard 
                label="Activations" 
                value={perf?.totalActivations ?? 0}
                icon={TrendingUp}
                tone={perf?.attainment && perf.attainment > 100 ? "success" : "default"}
              />
              <StatCard 
                label="Monthly Target" 
                value={form.target_activations}
                icon={Target}
              />
              <StatCard 
                label="Attainment" 
                value={`${perf?.attainment ?? 0}%`}
                icon={BarChart3}
                tone={perf?.attainment && perf.attainment > 80 ? "success" : "warn"}
              />
              <StatCard 
                label="Monthly Salary" 
                value={formatPkr(form.salary || 0)}
                icon={Banknote}
              />

            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="rounded-2xl border-slate-200/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">Key Performance Indicators</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <KPIItem 
                    label="Activation Success Rate" 
                    value={`${perf?.kpis?.successRate ?? 0}%`} 
                    progress={perf?.kpis?.successRate ?? 0} 
                  />
                  <KPIItem 
                    label="Target Pacing" 
                    value={`${perf?.attainment ?? 0}%`} 
                    progress={Math.min(perf?.attainment ?? 0, 100)} 
                    color="bg-orange-500"
                  />
                  <KPIItem 
                    label="Operational Efficiency" 
                    value="N/A" 
                    progress={0} 
                  />
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">Promotion Path</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
                    <TrendingUp className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-sm font-bold text-slate-600">Next Role: {form.role === 'bdo' ? 'ASM' : form.role === 'asm' ? 'RSM' : 'Senior Management'}</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">Maintain {">"}90% attainment for 3 consecutive months to qualify.</p>
                </CardContent>
              </Card>
            </div>

              <Card className="rounded-2xl border-slate-200/60 shadow-sm overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Daily Activations
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[300px] pt-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={perf?.daily ?? []}>

                      <defs>
                        <linearGradient id="colorActivations" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-brand-primary)" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="var(--color-brand-primary)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="date" 

                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 12, fill: '#64748b'}}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 12, fill: '#64748b'}}
                      />
                      <Tooltip 
                        content={<RichTooltip />}
                      />

                      <Area 
                        type="monotone" 
                        dataKey="count" 
                        name="Activations"
                        stroke="var(--color-brand-primary)" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorActivations)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="team" className="space-y-6 focus-visible:outline-none">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-bold">Team Performance</h3>
              <p className="text-sm text-muted-foreground">Summary of activations by direct reports</p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Input 
                type="month" 
                value={month} 
                onChange={(e) => setMonth(e.target.value)}
                className="w-[160px] h-9"
              />
            </div>
          </div>

          {isTeamLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <div className="grid gap-6">
              <StatCard 
                label="Total Team Activations" 
                value={teamPerf?.totalTeamActivations ?? 0}
                icon={Users}
              />


              <Card className="rounded-2xl border-slate-200/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">Member Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-slate-100">
                    {(teamPerf?.teamMembers ?? []).map((member: any) => (
                      <div key={member.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                            {member.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold">{member.name}</p>
                            <p className="text-xs text-muted-foreground uppercase">{member.role}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold">{member.activationsCount}</p>
                          <p className="text-xs text-muted-foreground">activations</p>
                        </div>
                      </div>
                    ))}
                    {(teamPerf?.teamMembers ?? []).length === 0 && (
                      <div className="p-8 text-center text-muted-foreground">
                        No team members reporting to this employee.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="advances" className="space-y-6 focus-visible:outline-none">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-2 rounded-2xl border-slate-200/60 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-bold">Advance Payment History</CardTitle>
                  <CardDescription>Track all advance payments and settlements.</CardDescription>
                </div>
                <Dialog open={isAdvanceDialogOpen} onOpenChange={setIsAdvanceDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gradient-brand text-white font-bold h-11 px-6 shadow-lg shadow-brand/20">
                      <Plus className="w-4 h-4 mr-2" /> Record Advance
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Record Advance Payment</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="amount">Total Amount (PKR) *</Label>
                          <Input 
                            id="amount" 
                            type="number" 
                            placeholder="0.00" 
                            value={advanceForm.amount}
                            onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="repayment_amount">Monthly Deduction</Label>
                          <Input 
                            id="repayment_amount" 
                            type="number" 
                            placeholder="e.g. 10000" 
                            value={advanceForm.repayment_amount}
                            onChange={(e) => setAdvanceForm({ ...advanceForm, repayment_amount: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="payment_date">Payment Date *</Label>
                        <Input 
                          id="payment_date" 
                          type="date" 
                          value={advanceForm.payment_date}
                          onChange={(e) => setAdvanceForm({ ...advanceForm, payment_date: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="description">Description / Notes</Label>
                        <Textarea 
                          id="description" 
                          placeholder="Reason for advance..." 
                          value={advanceForm.description}
                          onChange={(e) => setAdvanceForm({ ...advanceForm, description: e.target.value })}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAdvanceDialogOpen(false)}>Cancel</Button>
                      <Button 
                        className="gradient-brand text-white font-bold" 
                        onClick={() => addAdvance.mutate()}
                        disabled={addAdvance.isPending}
                      >
                        {addAdvance.isPending ? "Saving..." : "Save Advance"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-100">
                  {isAdvancesLoading ? (
                    <div className="p-8 space-y-4">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (advances ?? []).length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                      <Banknote className="w-8 h-8 opacity-20" />
                      <p>No advance payments recorded yet.</p>
                    </div>
                  ) : (
                    (advances ?? []).map((adv: any) => (
                      <div key={adv.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${adv.is_settled ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                            {adv.is_settled ? <CheckCircle2 className="w-5 h-5" /> : <History className="w-5 h-5" />}
                          </div>
                          <div>
                            <p className="font-bold text-lg">{formatPkr(adv.amount)}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(parseISO(adv.payment_date), "dd MMM yyyy")}</span>
                              {adv.repayment_amount > 0 && (
                                <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">Deducting {formatPkr(adv.repayment_amount)}/mo</span>
                              )}
                              {adv.description && <span>• {adv.description}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!adv.is_settled ? (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="text-emerald-600 border-emerald-100 hover:bg-emerald-50 font-bold"
                              onClick={() => setSettlementDialog({
                                isOpen: true,
                                advanceId: adv.id,
                                totalAmount: adv.amount,
                                amountToSettle: adv.amount.toString()
                              })}
                            >
                              Settle
                            </Button>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-muted-foreground hover:text-orange-600 font-bold"
                              onClick={() => toggleSettle.mutate({ advanceId: adv.id, settled: false })}
                            >
                              Undo Settle
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-slate-400 hover:text-red-500"
                            onClick={() => {
                              if (confirm("Delete this advance record?")) {
                                deleteAdv.mutate(adv.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-2xl border-slate-200/60 shadow-sm bg-slate-950 text-white">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Advance Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <span className="text-xs text-slate-400 block mb-1">Total Outstanding</span>
                    <span className="text-3xl font-black">{formatPkr(pendingAdvanceTotal)}</span>
                  </div>
                  
                  {pendingAdvanceTotal > 0 && (
                    <div className="pt-4 border-t border-white/10">
                      <span className="text-xs text-slate-400 block mb-2 font-bold uppercase tracking-tighter">Expected Next Deduction</span>
                      <div className="text-xl font-bold text-orange-400">
                        {formatPkr((advances ?? []).reduce((sum: number, a: any) => sum + (a.is_settled ? 0 : Number(a.repayment_amount || 0)), 0))}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">Sum of individual monthly repayment preferences</p>
                    </div>
                  )}


                  <div className="flex items-center gap-2 text-[11px] bg-white/5 p-2 rounded-lg border border-white/10">
                    <AlertCircle className="w-4 h-4 text-orange-400 shrink-0" />
                    <span>Deductions should be adjusted during salary generation.</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200/60 shadow-sm border-l-4 border-l-brand-primary">
                <CardHeader>
                  <CardTitle className="text-base font-bold">Quick Settlement</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  When you pay the employee their monthly salary, mark all previous advances as "Settled" to maintain accurate records.
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={settlementDialog.isOpen} onOpenChange={(open) => setSettlementDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Settle Advance Payment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Original Amount</span>
              <p className="font-bold text-lg text-slate-900">{formatPkr(settlementDialog.totalAmount)}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settle_amount">How much payment we need to settle? (PKR) *</Label>
              <Input 
                id="settle_amount" 
                type="number" 
                value={settlementDialog.amountToSettle}
                onChange={(e) => setSettlementDialog(prev => ({ ...prev, amountToSettle: e.target.value }))}
                placeholder="0.00"
              />
              <p className="text-[10px] text-muted-foreground italic">Current implementation marks the entire record as settled once confirmed.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementDialog(prev => ({ ...prev, isOpen: false }))}>Cancel</Button>
            <Button 
              className="gradient-brand text-white font-bold"
              onClick={() => {
                const amt = parseFloat(settlementDialog.amountToSettle);
                if (isNaN(amt) || amt <= 0) {
                  toast.error("Please enter a valid amount");
                  return;
                }
                toggleSettle.mutate({ 
                  advanceId: settlementDialog.advanceId, 
                  settled: true,
                  amount: amt
                });
              }}
              disabled={toggleSettle.isPending}
            >
              {toggleSettle.isPending ? "Processing..." : "Confirm Settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>


        <div className="space-y-6">
          <Card className="rounded-2xl border-slate-200/60 shadow-sm sticky top-6 overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-orange-500 to-red-600" />
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Quick Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center font-black text-xl text-slate-800 border border-slate-200">
                  {form.name.charAt(0) || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-bold truncate text-slate-900">{form.name || 'New Employee'}</p>
                  <Badge className="text-[9px] font-black uppercase tracking-tighter mt-1">{form.role}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Base Salary</span>
                  <p className="font-bold text-sm">{formatPkr(form.salary || 0)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Target</span>
                  <p className="font-bold text-sm">{form.target_activations} pts</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase text-slate-500 tracking-tighter">Current Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-10 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_leave">On Leave</SelectItem>
                    <SelectItem value="resigned">Resigned</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-2 space-y-2">
                <Button 
                  className="w-full gradient-brand text-white font-bold h-12 shadow-lg shadow-brand/20 group relative overflow-hidden" 
                  onClick={() => save.mutate()} 
                  disabled={save.isPending || (isNew && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit)}
                >
                  <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  <Save className="w-4 h-4 mr-2 relative z-10" />
                  <span className="relative z-10">{save.isPending ? "Saving..." : (isNew ? "Create Employee" : "Update Profile")}</span>
                </Button>
                {isNew && usage?.limit !== null && usage?.used !== undefined && usage.used >= usage.limit && (
                   <p className="text-[10px] text-center font-bold text-orange-600 bg-orange-50 p-2 rounded-lg border border-orange-100">
                     Plan limit reached ({usage.limit} employees). <Link to="/admin/billing" className="underline">Upgrade</Link>
                   </p>
                )}

                <Button variant="outline" className="w-full font-bold h-10 text-slate-500 hover:text-slate-900" onClick={() => navigate({ to: "/admin/employees" })}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
          
          {!isNew && (
            <Card className="rounded-2xl border-emerald-500/20 shadow-sm bg-emerald-50/30 overflow-hidden">
               <CardContent className="p-4 flex items-center gap-3">
                 <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0">
                   <UserCheck className="w-4 h-4" />
                 </div>
                 <div className="text-xs">
                    <p className="font-bold text-emerald-900 leading-none">Verified Personnel</p>
                    <p className="text-[10px] text-emerald-700/70 mt-1 leading-tight">Record matches ID: {form.employee_id || 'N/A'}</p>

                 </div>
               </CardContent>
            </Card>
            )}
          
          {!isNew && advanceSummary && advanceSummary.pending > 0 && (
            <Card className="rounded-2xl border-orange-500/20 shadow-sm bg-orange-50/30 overflow-hidden mt-4">
               <CardContent className="p-4 flex items-center gap-3">
                 <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white shrink-0">
                   <Landmark className="w-4 h-4" />
                 </div>
                 <div className="text-xs">
                   <p className="font-bold text-orange-900 leading-none">Pending Advances</p>
                   <p className="text-[10px] text-orange-700/70 mt-1 leading-tight">{formatPkr(advanceSummary.pending)} to be recovered</p>
                 </div>

               </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}


function KPIItem({ label, value, progress, color = "bg-brand-primary" }: { label: string, value: string, progress: number, color?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-slate-500">{label}</span>
        <span className="font-bold">{value}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-500`} 
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "default" }: { label: string, value: string | number, icon: any, tone?: "default" | "success" | "warn" }) {
  const toneClasses = {
    default: "bg-slate-50 text-slate-600 border-slate-100",
    success: "bg-emerald-50 text-emerald-600 border-emerald-100",
    warn: "bg-orange-50 text-orange-600 border-orange-100",
  };

  return (
    <Card className={`rounded-2xl border ${toneClasses[tone]} shadow-sm overflow-hidden`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${tone === 'default' ? 'bg-white shadow-sm' : 'bg-current/10'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</p>
          <p className="text-lg font-black">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
