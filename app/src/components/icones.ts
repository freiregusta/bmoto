/**
 * icones.ts — só os ícones que o app usa, importados um a um.
 *
 * Importar `* as lucide` traz ~1.000 ícones e engorda o bundle em centenas de
 * KB. O app é usado na rua, muitas vezes em 3G: cada KB importa. Ícone novo
 * no manifesto de um módulo? acrescente aqui — se faltar, cai no `Circle`.
 */

import {
  Activity, AlertCircle, AlertTriangle, ArrowDownLeft, ArrowDown, ArrowRight, ArrowUp,
  ArrowUpRight, Banknote, Bike, Calculator, CalendarCheck, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronUp, Circle, Clock, Copy, CreditCard, FileSignature,
  FileText, GitBranch, HeartPulse, Home, Inbox, Info, KeyRound, Landmark, LayoutDashboard,
  LayoutGrid, Loader2, Pencil, PlugZap, Plus, Power, PowerOff, Receipt, RefreshCw, Route,
  ScrollText, SearchX, Send, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Trash2,
  TrendingUp, User, Wallet, Wand2, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ICONES: Record<string, LucideIcon> = {
  Activity, AlertCircle, AlertTriangle, ArrowDown, ArrowDownLeft, ArrowRight, ArrowUp,
  ArrowUpRight, Banknote, Bike, Calculator, CalendarCheck, Check, CheckCircle2, ChevronDown,
  ChevronRight, ChevronUp, Circle, Clock, Copy, CreditCard, FileSignature, FileText, GitBranch,
  HeartPulse, Home, Inbox, Info, KeyRound, Landmark, LayoutDashboard, LayoutGrid, Loader2,
  Pencil, PlugZap, Plus, Power, PowerOff, Receipt, RefreshCw, Route, ScrollText, SearchX,
  Send, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Trash2, TrendingUp, User, Wallet,
  Wand2, X,
};

export const PADRAO = Circle;
