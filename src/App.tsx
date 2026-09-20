import React, { useEffect, useState, useRef, Component, useMemo } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, User } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, where, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { Order, Product, Settings, OrderStatus, LabelType, StockLog, Bill, RegularCustomer } from './types';
import { BillMakerView } from './components/BillMakerView';
import { MoneyOrderCalibrator } from './components/MoneyOrderCalibrator';
import { cn, formatCurrency, generateTrackingNumber, getWhatsAppLink, generateCustomerMessage, splitMoneyOrderAmounts, normalizeUrduProductName, deduplicateProducts } from './lib/utils';
import { sendMetaWhatsAppMessage, parseMetaError, checkMetaAccountInfo, formatPhoneForMeta, MetaSendResult } from './lib/metaWhatsapp';
import { MetaWhatsAppInspectorModal } from './components/MetaWhatsAppInspectorModal';
import { BulkMoneyOrderModal } from './components/BulkMoneyOrderModal';
import { UserApprovalModal } from './components/UserApprovalModal';
import { AccountModal } from './components/AccountModal';
import { VoiceAddressRecorder, ExtractedVoiceAddress } from './components/VoiceAddressRecorder';
import { BulkStockImportModal } from './components/BulkStockImportModal';
import { openWhatsAppDirectly, readClipboardText } from './lib/addressParser';
import { UserX, Mic, MicOff, ClipboardPaste } from 'lucide-react';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Settings as SettingsIcon, 
  Plus, 
  Search, 
  ChevronRight, 
  Printer, 
  Trash2, 
  LogOut, 
  AlertTriangle,
  TrendingUp,
  Clock,
  CheckCircle2,
  Truck,
  Box,
  MessageSquare,
  Download,
  QrCode,
  Wallet,
  Calendar,
  FileText,
  Pencil,
  ExternalLink,
  Copy,
  BookOpen,
  X,
  Upload,
  Check,
  FileSpreadsheet,
  Phone,
  ArrowUpDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format, subDays, subMonths, lastDayOfMonth, startOfWeek, endOfWeek, isWithinInterval, startOfMonth, endOfMonth, startOfYear, endOfYear, isSameDay, isSameWeek, isSameMonth, isSameYear, parseISO, addDays } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { safeHtml2Canvas } from './lib/html2canvasUtil';
import * as XLSX from 'xlsx';
import { Sparkles, Banknote, RefreshCw, Users } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

export const mapCarrierToCourier = (carrierReq?: string, trackingIdReq?: string) => {
  if (carrierReq) {
    const norm = carrierReq.toLowerCase().trim();
    if (norm.includes('leopard')) return 'leopards';
    if (norm.includes('tcs')) return 'tcs';
    if (norm.includes('post') || norm.includes('pak')) return 'pakpost';
  }
  if (trackingIdReq) {
    const tid = trackingIdReq.toUpperCase().trim();
    if (tid.startsWith('KI')) return 'leopards';
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tid)) return 'pakpost';
    if (/^\d{10,15}$/.test(tid) || /^\d+$/.test(tid)) return 'tcs';
  }
  return 'pakpost';
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error (Gracefully Handled): ', JSON.stringify(errInfo));
  const errMsg = error instanceof Error ? error.message : String(error);
  if (errMsg.includes('permission-denied') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('denied')) {
    toast.error('فائر سٹور ڈیٹا تک رسائی محدود ہے (رسائی کی حد یا اختیار کی خرابی)');
  } else {
    toast.error('ڈیٹا لوڈنگ میں خلل: ' + errMsg.substring(0, 50));
  }
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        if ((this as any).state.error?.message) {
          const message = (this as any).state.error.message;
          if (message.startsWith('{') && message.endsWith('}')) {
            const parsed = JSON.parse(message);
            if (parsed.error) errorMessage = `Database Error: ${parsed.error}`;
          } else {
            errorMessage = message;
          }
        }
      } catch (e) {
        errorMessage = (this as any).state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir="rtl">
          <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">ایپلی کیشن میں خرابی</h2>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <Button onClick={() => window.location.reload()} className="w-full font-bold">
              ایپلی کیشن دوبارہ لوڈ کریں
            </Button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: any) => {
  const variants: any = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-[0_4px_14px_rgba(99,102,241,0.3)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.4)]',
    secondary: 'bg-white text-gray-700 border border-gray-200/80 hover:bg-gray-50 shadow-sm hover:border-gray-300',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-[0_4px_14px_rgba(239,68,68,0.25)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.35)]',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900',
  };
  return (
    <button
      className={cn(
        'px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-250 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2',
        variants[variant],
        className
      )}
      {...props}
    />
  );
};

const Input = ({ className, ...props }: any) => (
  <input
    className={cn(
      'w-full px-4 py-2.5 rounded-xl border border-gray-200/80 bg-white/60 focus:bg-white placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all duration-200 text-sm font-medium',
      className
    )}
    {...props}
  />
);

const Label = ({ children, className }: any) => (
  <label className={cn('block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5', className)}>
    {children}
  </label>
);

const Card = ({ children, className, ...props }: any) => (
  <div 
    className={cn('bg-white rounded-2xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] transition-all ease-out duration-300 hover:shadow-[0_12px_40px_rgb(0,0,0,0.035)] p-5', className)}
    {...props}
  >
    {children}
  </div>
);

const Badge = ({ children, status }: { children: string; status: OrderStatus }) => {
  const colors: any = {
    Pending: 'bg-amber-50 text-amber-700 border-amber-100/60',
    Packed: 'bg-blue-50 text-blue-700 border-blue-100/60',
    Shipped: 'bg-indigo-50 text-indigo-700 border-indigo-100/60',
    Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-100/60',
    Returned: 'bg-red-50 text-red-700 border-red-100/60',
    Cancelled: 'bg-slate-50 text-slate-700 border-slate-100/60',
  };
  
  const dots: any = {
    Pending: 'bg-amber-500',
    Packed: 'bg-blue-500',
    Shipped: 'bg-indigo-500',
    Delivered: 'bg-emerald-500',
    Returned: 'bg-red-500',
    Cancelled: 'bg-slate-400',
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', colors[status] || 'bg-gray-50 text-gray-700 border-gray-150')}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dots[status] || 'bg-gray-400')} />
      {children}
    </span>
  );
};

import { Chatbot } from './components/Chatbot';
import { PersonalLedgerView } from './components/PersonalLedgerView';

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const cached = localStorage.getItem('shipflow_products');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const cached = localStorage.getItem('shipflow_orders');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [stockLogs, setStockLogs] = useState<StockLog[]>(() => {
    try {
      const cached = localStorage.getItem('shipflow_stockLogs');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [bills, setBills] = useState<Bill[]>(() => {
    try {
      const cached = localStorage.getItem('shipflow_bills');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [settings, setSettings] = useState<Settings | null>(() => {
    try {
      const cached = localStorage.getItem('shipflow_settings');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [role, setRole] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<'approved' | 'pending' | 'rejected' | 'loading'>('loading');
  const [showUserApprovalModal, setShowUserApprovalModal] = useState(false);
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [whatsappLogs, setWhatsappLogs] = useState<MetaSendResult[]>([]);
  const [showInspectorModal, setShowInspectorModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [latestInspectResult, setLatestInspectResult] = useState<MetaSendResult | null>(null);

  useEffect(() => {
    let active = true;
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        if (active) {
          setConnectionError(null);
        }
      } catch (error) {
        if (active) {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('the client is offline') || errMsg.includes('Failed to get document')) {
            setConnectionError("سسٹم فل وقت آف لائن موڈ میں کام کر رہا ہے (آف لائن ڈیٹا دستیاب رہے گا)");
            console.warn("Firestore connection status: Client is operating in offline mode.");
          } else {
            console.warn("Firestore connection check info:", errMsg);
          }
        }
      }
    }
    
    testConnection();
    
    // Periodically retry check in background to auto-clear offline message when online
    const intervalId = setInterval(testConnection, 30000);
    
    const handleOnline = () => {
      testConnection();
    };
    
    window.addEventListener('online', handleOnline);
    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showBulkOrderModal, setShowBulkOrderModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [trackingSearchId, setTrackingSearchId] = useState('');
  const [trackingSearchCarrier, setTrackingSearchCarrier] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [dismissedLowStockAlert, setDismissedLowStockAlert] = useState(false);

  const lowStockProducts = products.filter(p => p.stock <= p.lowStockThreshold).length;
  const isAdmin = user?.email === 'noorullah03474763055@gmail.com' || user?.email === 'noorullah111111111@gmail.com' || role === 'admin';
  const [filterType, setFilterType] = useState<'All' | 'Year' | 'Month' | 'Week' | 'Day'>('Month');
  const [filterValue, setFilterValue] = useState(format(new Date(), 'yyyy-MM'));

  const availablePeriods = useMemo(() => {
    const orderDates = orders.map(o => new Date(o.createdAt));
    const logDates = stockLogs.map(l => new Date(l.createdAt));
    const allDates = [...orderDates, ...logDates];
    
    const years = Array.from(new Set(allDates.map(d => format(d, 'yyyy')))).sort((a, b) => (b as string).localeCompare(a as string));
    const months = Array.from(new Set(allDates.map(d => format(d, 'yyyy-MM')))).sort((a, b) => (b as string).localeCompare(a as string));
    const weeks = Array.from(new Set(allDates.map(d => format(d, "yyyy-'W'II")))).sort((a, b) => (b as string).localeCompare(a as string));
    const days = Array.from(new Set(allDates.map(d => format(d, 'yyyy-MM-dd')))).sort((a, b) => (b as string).localeCompare(a as string));

    // Ensure current periods are present
    const currentYear = format(new Date(), 'yyyy');
    const currentMonth = format(new Date(), 'yyyy-MM');
    const currentWeek = format(new Date(), "yyyy-'W'II");
    const currentDay = format(new Date(), 'yyyy-MM-dd');

    if (!years.includes(currentYear)) years.unshift(currentYear);
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    if (!weeks.includes(currentWeek)) weeks.unshift(currentWeek);
    if (!days.includes(currentDay)) days.unshift(currentDay);

    return { years, months, weeks, days };
  }, [orders, stockLogs]);

  const filteredOrders = useMemo(() => {
    if (filterType === 'All') return orders;
    return orders.filter(o => {
      const date = new Date(o.createdAt);
      if (filterType === 'Year') return format(date, 'yyyy') === filterValue;
      if (filterType === 'Month') return format(date, 'yyyy-MM') === filterValue;
      if (filterType === 'Week') return format(date, "yyyy-'W'II") === filterValue;
      if (filterType === 'Day') return format(date, 'yyyy-MM-dd') === filterValue;
      return true;
    });
  }, [orders, filterType, filterValue]);

  const stockSummary = useMemo(() => {
    const summary = filteredOrders.reduce((acc: any, order) => {
      if (order.status === 'Cancelled' || order.status === 'Returned') return acc;
      order.items.forEach(item => {
        const key = item.productId || item.name;
        if (!acc[key]) {
          acc[key] = { 
            id: key,
            name: item.name, 
            quantity: 0, 
            totalCost: 0, 
            totalAmount: 0 
          };
        }
        acc[key].quantity += item.quantity;
        acc[key].totalCost += (item.cost || 0) * item.quantity;
        acc[key].totalAmount += (item.price || 0) * item.quantity;
      });
      return acc;
    }, {});
    return Object.values(summary);
  }, [filteredOrders]);

  const calculateActualProfit = (order: Order) => {
    if (order.status === 'Returned') return -(order.deliveryCharges || 0);
    if (order.status === 'Cancelled') return 0;
    return order.totalProfit || 0;
  };

  const totalRevenue = useMemo(() => filteredOrders.reduce((sum, o) => o.status === 'Returned' ? sum : sum + (o.totalAmount || 0), 0), [filteredOrders]);
  const totalProfit = useMemo(() => filteredOrders.reduce((sum, o) => sum + calculateActualProfit(o), 0), [filteredOrders]);
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const partnerStats = useMemo(() => Object.values(filteredOrders.reduce((acc: any, order) => {
    const partner = order.partnerName?.trim() || 'Direct Sales';
    if (!acc[partner]) {
      acc[partner] = { name: partner, partnerProfit: 0, myProfit: 0, totalProfit: 0, orderCount: 0, paid: 0 };
    }
    
    const actualProfit = calculateActualProfit(order);
    const partnerShare = order.partnerProfitAmount || 0;
    const myShare = actualProfit - partnerShare;

    acc[partner].partnerProfit += partnerShare;
    acc[partner].myProfit += myShare;
    acc[partner].totalProfit += actualProfit;
    acc[partner].orderCount += 1;
    if (order.partnerPaid) {
      acc[partner].paid += partnerShare;
    }
    
    return acc;
  }, {})), [filteredOrders]);

  const downloadReport = async () => {
    let periodName = 'All Time';
    if (filterType === 'Year') periodName = filterValue;
    if (filterType === 'Month') periodName = format(new Date(filterValue + '-01'), 'MMMM yyyy');
    if (filterType === 'Week') periodName = `Week ${filterValue.split('-W')[1]}, ${filterValue.split('-W')[0]}`;
    if (filterType === 'Day') periodName = format(new Date(filterValue), 'MMM dd, yyyy');
    
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    const rootDiv = document.createElement('div');
    container.appendChild(rootDiv);
    const root = createRoot(rootDiv);

    await new Promise<void>((resolve) => {
      root.render(
        <ReportTemplate 
          orders={filteredOrders}
          periodName={periodName}
          totalRevenue={totalRevenue}
          totalProfit={totalProfit}
          profitMargin={profitMargin}
          partnerStats={partnerStats}
          stockSummary={stockSummary}
        />
      );
      setTimeout(resolve, 1000);
    });

    try {
      const canvas = await safeHtml2Canvas(rootDiv, { 
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true
      });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = (pdf as any).getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`ShipFlow_Report_${periodName.replace(/[^a-z0-9]/gi, '_')}.pdf`);
    } catch (error) {
      console.error('Report generation failed:', error);
      alert('Failed to generate report. Please try again.');
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  };

  const downloadPartnerReport = async (partnerName: string) => {
    const partnerOrders = orders.filter((o: Order) => {
      const matchesPartner = o.partnerName?.trim() === partnerName.trim();
      const matchesPeriod = filterType === 'All' ? true : (
        filterType === 'Year' ? format(new Date(o.createdAt), 'yyyy') === filterValue :
        filterType === 'Month' ? format(new Date(o.createdAt), 'yyyy-MM') === filterValue :
        filterType === 'Week' ? format(new Date(o.createdAt), "yyyy-'W'II") === filterValue :
        filterType === 'Day' ? format(new Date(o.createdAt), 'yyyy-MM-dd') === filterValue : true
      );
      return matchesPartner && matchesPeriod;
    });
    let periodName = 'All Time';
    if (filterType === 'Year') periodName = filterValue;
    if (filterType === 'Month') periodName = format(new Date(filterValue + '-01'), 'MMMM yyyy');
    if (filterType === 'Week') periodName = `Week ${filterValue.split('-W')[1]}, ${filterValue.split('-W')[0]}`;
    if (filterType === 'Day') periodName = format(new Date(filterValue), 'MMM dd, yyyy');
    
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    const rootDiv = document.createElement('div');
    container.appendChild(rootDiv);
    const root = createRoot(rootDiv);

    await new Promise<void>((resolve) => {
      root.render(
        <PartnerReportTemplate 
          orders={partnerOrders}
          partnerName={partnerName}
          periodName={periodName}
        />
      );
      setTimeout(resolve, 1000);
    });

    try {
      const canvas = await safeHtml2Canvas(rootDiv, { 
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true
      });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = (pdf as any).getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`Partner_Report_${partnerName}_${periodName}.pdf`);
    } catch (error) {
      console.error('Partner report generation failed:', error);
      alert('Failed to generate partner report.');
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  };

  const downloadStockReport = async (supplierNameParam: any = null, forceAllTime: boolean = false) => {
    const supplierName = typeof supplierNameParam === 'string' ? supplierNameParam : null;
    const effectiveFilterType = forceAllTime ? 'All' : filterType;

    const filteredLogs = stockLogs.filter(log => {
      const date = new Date(log.createdAt);
      
      // Date Filter
      let matchesDate = true;
      if (effectiveFilterType === 'All') matchesDate = true;
      else if (effectiveFilterType === 'Year') matchesDate = format(date, 'yyyy') === filterValue;
      else if (effectiveFilterType === 'Month') matchesDate = format(date, 'yyyy-MM') === filterValue;
      else if (effectiveFilterType === 'Week') matchesDate = format(date, "yyyy-'W'II") === filterValue;
      else if (effectiveFilterType === 'Day') matchesDate = format(date, 'yyyy-MM-dd') === filterValue;

      if (!matchesDate) return false;

      // Supplier Filter
      if (!supplierName || supplierName === 'All') return true;
      const product = products.find(p => p.id === log.productId);
      if (supplierName === 'Direct') {
        return !product || !product.supplierName || product.supplierName.trim() === '';
      }
      return product && product.supplierName === supplierName;
    });

    // Chronological order: Oldest / earliest date entered comes FIRST (1, 2, 3...)
    const sortedLogs = [...filteredLogs].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });

    const totalQty = sortedLogs.reduce((sum, log) => sum + (log.quantity || 0), 0);
    const totalCost = sortedLogs.reduce((sum, log) => sum + (log.totalCost || 0), 0);

    let periodName = 'All Time';
    if (!forceAllTime) {
      if (filterType === 'Year') periodName = filterValue;
      if (filterType === 'Month') periodName = format(new Date(filterValue + '-01'), 'MMMM yyyy');
      if (filterType === 'Week') periodName = `Week ${filterValue.split('-W')[1]}, ${filterValue.split('-W')[0]}`;
      if (filterType === 'Day') periodName = format(new Date(filterValue), 'MMM dd, yyyy');
    }
    
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    const rootDiv = document.createElement('div');
    container.appendChild(rootDiv);
    const root = createRoot(rootDiv);

    await new Promise<void>((resolve) => {
      root.render(
        <StockReportTemplate 
          supplierName={supplierName} 
          products={products} 
          stockLogs={sortedLogs}
          periodName={periodName}
          totalQty={totalQty}
          totalCost={totalCost}
        />
      );
      setTimeout(resolve, 1000);
    });

    try {
      const canvas = await safeHtml2Canvas(rootDiv, { 
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true
      });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = (pdf as any).getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`Stock_Addition_Report_${periodName.replace(/[^a-z0-9]/gi, '_')}.pdf`);
    } catch (error) {
      console.error('Stock report generation failed:', error);
      alert('Failed to generate stock report.');
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  };

  // Android WebView (native app) میں Google popup sign-in کام نہیں کرتا، اس لیے redirect flow
  const isNativeApp = () => typeof (window as any).AndroidApi !== 'undefined';

  const signInWithGoogle = async (provider: GoogleAuthProvider) => {
    if (isNativeApp()) {
      await signInWithRedirect(auth, provider);
      return null; // صفحہ Google کی طرف چلا گیا؛ واپسی پر getRedirectResult سنبھالے گا
    }
    return await signInWithPopup(auth, provider);
  };

  const ensureUserDoc = async (fbUser: User, mergeExisting: boolean, newNonAdminToast?: string) => {
    const uEmail = fbUser.email || '';
    const isAdminEmail = uEmail === 'noorullah03474763055@gmail.com' || uEmail === 'noorullah111111111@gmail.com';

    const userDocRef = doc(db, 'users', fbUser.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      await setDoc(userDocRef, {
        uid: fbUser.uid,
        email: uEmail,
        displayName: fbUser.displayName || '',
        photoURL: fbUser.photoURL || '',
        role: isAdminEmail ? 'admin' : 'user',
        status: isAdminEmail ? 'approved' : 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (!isAdminEmail && newNonAdminToast) {
        toast.success(newNonAdminToast);
      }
    } else if (mergeExisting) {
      await setDoc(userDocRef, {
        displayName: fbUser.displayName || '',
        photoURL: fbUser.photoURL || '',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  };

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        // Silent connection test to avoid confusing users if it's transient
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      setLoading(false);
    });

    // Native app میں redirect login کے بعد واپسی پر نتیجہ حاصل کریں
    getRedirectResult(auth).then(async (result) => {
      if (result && result.user) {
        try {
          await ensureUserDoc(result.user, true, 'لاگ ان ہو گیا! ایڈمن کی منظوری کے لیے درخواست بھیج دی گئی ہے');
        } catch (e) {
          console.error('Redirect user-doc failed:', e);
        }
      }
    }).catch((error) => {
      console.error('Redirect login failed:', error);
      showLoginError(error, 'لاگ ان مکمل نہیں ہو سکا');
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    const isPrimaryAdmin = user.email === 'noorullah03474763055@gmail.com' || user.email === 'noorullah111111111@gmail.com';

    // Helper to consolidate duplicate products in Firestore (runs silently in background)
    let isConsolidating = false;
    const consolidateDuplicateProductsInDb = async (rawProducts: Product[]) => {
      if (isConsolidating) return;
      isConsolidating = true;
      try {
        const groups = new Map<string, Product[]>();
        rawProducts.forEach(p => {
          const key = normalizeUrduProductName(p.name);
          if (!key) return;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p);
        });

        for (const [key, group] of groups.entries()) {
          if (group.length > 1) {
            const sorted = [...group].sort((a, b) => {
              if ((b.stock || 0) !== (a.stock || 0)) return (b.stock || 0) - (a.stock || 0);
              if ((b.sellingPrice || 0) !== (a.sellingPrice || 0)) return (b.sellingPrice || 0) - (a.sellingPrice || 0);
              return (a.createdAt || '').localeCompare(b.createdAt || '');
            });

            const primary = sorted[0];
            const duplicates = sorted.slice(1);
            const totalStock = group.reduce((sum, p) => sum + (p.stock || 0), 0);
            const bestCostPrice = group.find(p => (p.costPrice || 0) > 0)?.costPrice || primary.costPrice || 0;
            const bestSellingPrice = group.find(p => (p.sellingPrice || 0) > 0)?.sellingPrice || primary.sellingPrice || 0;
            const bestSupplier = group.find(p => p.supplierName && p.supplierName.trim())?.supplierName || primary.supplierName || '';

            // Update primary document
            await updateDoc(doc(db, 'products', primary.id), {
              stock: totalStock,
              costPrice: bestCostPrice,
              sellingPrice: bestSellingPrice,
              supplierName: bestSupplier
            });

            // Point stockLogs to primary and delete duplicate docs
            for (const dup of duplicates) {
              try {
                const logsSnap = await getDocs(query(collection(db, 'stockLogs'), where('productId', '==', dup.id)));
                if (!logsSnap.empty) {
                  const batchLogs = writeBatch(db);
                  logsSnap.docs.forEach(lDoc => {
                    batchLogs.update(lDoc.ref, { productId: primary.id });
                  });
                  await batchLogs.commit();
                }
              } catch (e) {
                console.warn('Migrating stockLogs failed:', e);
              }

              try {
                await deleteDoc(doc(db, 'products', dup.id));
              } catch (e) {
                console.warn('Deleting duplicate product doc failed:', e);
              }
            }
          }
        }
      } catch (err) {
        console.error('Background product consolidation failed:', err);
      } finally {
        isConsolidating = false;
      }
    };

    // Products
    const qProducts = isPrimaryAdmin 
      ? query(collection(db, 'products'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'products'), where('userId', '==', user.uid));

    const unsubProducts = onSnapshot(qProducts, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      if (isPrimaryAdmin) {
        data = data.filter(p => !p.userId || p.userId === user.uid);
      } else {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }

      // 1. Immediately deduplicate so UI renders every product strictly ONCE with combined stock
      const uniqueData = deduplicateProducts(data);
      setProducts(uniqueData);

      // 2. If duplicate docs exist in Firestore, clean them up permanently in background
      if (data.length > uniqueData.length) {
        consolidateDuplicateProductsInDb(data);
      }

      try {
        localStorage.setItem(`shipflow_products_${user.uid}`, JSON.stringify(uniqueData));
      } catch (e) {
        console.warn('LocalStorage save products failed:', e);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'products');
    });

    // Orders
    const qOrders = isPrimaryAdmin
      ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'orders'), where('userId', '==', user.uid));

    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      if (isPrimaryAdmin) {
        data = data.filter(o => !o.userId || o.userId === user.uid);
      } else {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }
      setOrders(data);
      try {
        localStorage.setItem(`shipflow_orders_${user.uid}`, JSON.stringify(data));
      } catch (e) {
        console.warn('LocalStorage save orders failed:', e);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'orders');
    });

    // Stock Logs
    const qStockLogs = isPrimaryAdmin
      ? query(collection(db, 'stockLogs'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'stockLogs'), where('userId', '==', user.uid));

    const unsubStockLogs = onSnapshot(qStockLogs, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockLog));
      if (isPrimaryAdmin) {
        data = data.filter(s => !s.userId || s.userId === user.uid);
      } else {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }
      setStockLogs(data);

      // Auto-heal: If any stockLog was saved with August 2026-08-09 due to 9/8/26 ambiguity,
      // silently migrate it to September (2026-09-08) so all 13 items appear in September reports
      data.forEach(async (log: any) => {
        if (
          log.createdAt &&
          log.createdAt.startsWith('2026-08-09') &&
          log.reason &&
          log.reason.includes('2026-08-09')
        ) {
          try {
            const correctedDate = log.createdAt.replace('2026-08-09', '2026-09-08');
            const correctedReason = log.reason.replace('2026-08-09', '2026-09-08');
            await updateDoc(doc(db, 'stockLogs', log.id), {
              createdAt: correctedDate,
              reason: correctedReason
            });
          } catch (err) {
            console.error('Failed to auto-heal stockLog date:', err);
          }
        }
      });
      try {
        localStorage.setItem(`shipflow_stockLogs_${user.uid}`, JSON.stringify(data));
      } catch (e) {
        console.warn('LocalStorage save stockLogs failed:', e);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'stockLogs');
    });

    // Bills
    const qBills = isPrimaryAdmin
      ? query(collection(db, 'bills'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'bills'), where('userId', '==', user.uid));

    const unsubBills = onSnapshot(qBills, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      if (isPrimaryAdmin) {
        data = data.filter(b => !b.userId || b.userId === user.uid);
      } else {
        data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      }
      setBills(data);
      try {
        localStorage.setItem(`shipflow_bills_${user.uid}`, JSON.stringify(data));
      } catch (e) {
        console.warn('LocalStorage save bills failed:', e);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bills');
    });

    // Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', user.uid), async (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data() as Settings;
        setSettings(data);
        try {
          localStorage.setItem(`shipflow_settings_${user.uid}`, JSON.stringify(data));
        } catch (e) {
          console.warn('LocalStorage save settings failed:', e);
        }
      } else {
        try {
          const globalSnap = await getDoc(doc(db, 'settings', 'global'));
          if (globalSnap.exists()) {
            const globalData = globalSnap.data() as Settings;
            setSettings({ ...globalData, userId: user.uid });
          } else {
            setSettings({
              senderName: user.displayName || 'آن لائن اسٹور',
              senderPhone: '',
              senderAddress: '',
              senderCity: '',
              userId: user.uid
            });
          }
        } catch (e) {
          setSettings({
            senderName: user.displayName || 'آن لائن اسٹور',
            senderPhone: '',
            senderAddress: '',
            senderCity: '',
            userId: user.uid
          });
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${user.uid}`);
    });

    const unsubUser = onSnapshot(doc(db, 'users', user.uid), async (docSnap) => {
      if (isPrimaryAdmin) {
        setRole('admin');
        setUserStatus('approved');
        if (!docSnap.exists()) {
          try {
            await setDoc(doc(db, 'users', user.uid), {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || '',
              photoURL: user.photoURL || '',
              role: 'admin',
              status: 'approved',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } catch (e) {
            console.warn('Failed to set admin user doc:', e);
          }
        }
      } else {
        if (docSnap.exists()) {
          const uData = docSnap.data();
          setRole(uData.role || 'user');
          setUserStatus(uData.status || 'pending');
        } else {
          setRole('user');
          setUserStatus('pending');
          try {
            await setDoc(doc(db, 'users', user.uid), {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || '',
              photoURL: user.photoURL || '',
              role: 'user',
              status: 'pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } catch (e) {
            console.warn('Failed to set pending user doc:', e);
          }
        }
      }
    }, (error) => {
      if (isPrimaryAdmin) {
        setRole('admin');
        setUserStatus('approved');
      } else {
        setUserStatus('pending');
      }
    });

    return () => {
      unsubProducts();
      unsubOrders();
      unsubStockLogs();
      unsubBills();
      unsubSettings();
      unsubUser();
    };
  }, [user]);

  // Admin pending users listener
  useEffect(() => {
    if (!user) return;
    const isPrimaryAdmin = user.email === 'noorullah03474763055@gmail.com' || user.email === 'noorullah111111111@gmail.com' || role === 'admin';
    if (!isPrimaryAdmin) return;

    const unsubPending = onSnapshot(collection(db, 'users'), (snapshot) => {
      const pendingList = snapshot.docs.filter(d => {
        const uData = d.data();
        const isAdminUser = uData.email === 'noorullah03474763055@gmail.com' || uData.email === 'noorullah111111111@gmail.com' || uData.role === 'admin';
        if (isAdminUser) return false;
        if (uData.status === 'approved' || uData.status === 'rejected') return false;
        return true; // Any non-admin user without explicitly approved/rejected is pending
      });
      setPendingUsersCount(pendingList.length);
    }, (err) => {
      console.warn('Pending users snapshot error:', err);
    });

    return () => unsubPending();
  }, [user, role]);

  const togglePaymentStatus = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { 
        paymentReceived: !order.paymentReceived,
        paymentReceivedAt: !order.paymentReceived ? new Date().toISOString() : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const togglePartnerPaidStatus = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { 
        partnerPaid: !order.partnerPaid,
        partnerPaidAt: !order.partnerPaid ? new Date().toISOString() : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  // لاگ ان کی خرابی صارف کو واضح الفاظ میں دکھائیں تاکہ اصل وجہ سمجھ آئے
  const showLoginError = (error: any, fallbackMsg: string) => {
    if (error?.code === 'auth/popup-closed-by-user') return;
    console.error('Login failed:', error);
    if (error?.code === 'auth/unauthorized-domain') {
      toast.error('ایپ کو Firebase میں اجازت نہیں ملی — Firebase Console کے Authorized domains میں appassets.androidplatform.net شامل کریں', { duration: 9000 });
    } else {
      toast.error(fallbackMsg + (error?.code ? ` (${error.code})` : ''), { duration: 6000 });
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithGoogle(provider);
      if (result && result.user) {
        await ensureUserDoc(result.user, true, 'لاگ ان ہو گیا! ایڈمن کی منظوری کے لیے درخواست بھیج دی گئی ہے');
      }
    } catch (error: any) {
      showLoginError(error, 'لاگ ان ناکام رہا');
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      toast.success('آپ کامیابی سے لاگ آؤٹ ہو گئے ہیں');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('لاگ آؤٹ کرنے میں مسئلہ آیا');
    }
  };

  const handleSwitchAccount = async () => {
    try {
      await auth.signOut();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithGoogle(provider);
      if (result && result.user) {
        await ensureUserDoc(result.user, false);
        toast.success('اکاؤنٹ کامیابی سے تبدیل ہو گیا!');
      }
    } catch (error: any) {
      showLoginError(error, 'اکاؤنٹ تبدیل نہیں ہو سکا');
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const oldStatus = order.status;
      await updateDoc(doc(db, 'orders', orderId), { status: newStatus });
      
      // Handle Stock Return if status changes to Returned
      if (newStatus === 'Returned' && oldStatus !== 'Returned') {
        for (const item of order.items) {
          const productRef = doc(db, 'products', item.productId);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const currentStock = productSnap.data().stock || 0;
            await updateDoc(productRef, { stock: currentStock + (item.quantity || 0) });
          }
        }
      } 
      // Handle Stock Deduction if status changes FROM Returned to something else
      else if (oldStatus === 'Returned' && newStatus !== 'Returned') {
        for (const item of order.items) {
          const productRef = doc(db, 'products', item.productId);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const currentStock = productSnap.data().stock || 0;
            await updateDoc(productRef, { stock: currentStock - (item.quantity || 0) });
          }
        }
      }

      if (newStatus === 'Shipped') {
        const msg = generateCustomerMessage({ ...order, status: newStatus });
        window.open(getWhatsAppLink(order.customerPhone, msg), '_blank');
      } else if (newStatus === 'Returned') {
        const msg = generateCustomerMessage({ ...order, status: newStatus });
        window.open(getWhatsAppLink(order.customerPhone, msg), '_blank');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const bulkPrint = async (ordersToPrint: Order[]) => {
    if (ordersToPrint.length === 0) return alert('No orders to print');
    
    const toastId = toast.loading(`${ordersToPrint.length} لیبل پرنٹنگ کی تیاری جاری ہے...`);

    try {
      await new Promise(r => setTimeout(r, 100));

      const pdf = new jsPDF('p', 'mm', 'a4');
      const labelsPerPage = 6;
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 10;
      const labelWidth = (pageWidth - (margin * 3)) / 2;
      const maxLabelHeight = (pageHeight - (margin * 4)) / 3;
      
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '350px';
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '-9999';
      document.body.appendChild(container);

      for (let i = 0; i < ordersToPrint.length; i++) {
        // Yield to browser event loop before rendering each label to prevent freeze/offline drops
        await new Promise(r => setTimeout(r, 60));

        const order = ordersToPrint[i];
        const labelIndex = i % labelsPerPage;
        
        if (i > 0 && labelIndex === 0) {
          pdf.addPage();
        }
        
        const rootDiv = document.createElement('div');
        container.appendChild(rootDiv);
        const root = createRoot(rootDiv);
        
        await new Promise<void>((resolve) => {
          root.render(<ShippingLabel order={order} settings={settings} />);
          setTimeout(resolve, 200);
        });
        
        const targetEl = (rootDiv.firstElementChild as HTMLElement) || rootDiv;
        const canvas = await safeHtml2Canvas(targetEl, { 
          scale: 2, 
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        });
        const imgData = canvas.toDataURL('image/png', 0.95);
        
        const imgProps = (pdf as any).getImageProperties(imgData);
        const pdfHeight = (imgProps.height * labelWidth) / imgProps.width;
        
        const col = labelIndex % 2;
        const row = Math.floor(labelIndex / 2);
        
        const x = margin + (col * (labelWidth + margin));
        const y = margin + (row * (maxLabelHeight + margin));
        
        pdf.addImage(imgData, 'PNG', x, y, labelWidth, Math.min(pdfHeight, maxLabelHeight));
        
        canvas.width = 0;
        canvas.height = 0;
        root.unmount();
        container.removeChild(rootDiv);
      }
      
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      toast.dismiss(toastId);
      toast.success(`${ordersToPrint.length} لیبلز ڈاؤن لوڈ ہو گئے`);
      pdf.save(`Bulk_Labels_${ordersToPrint.length}.pdf`);
    } catch (err) {
      console.error('Bulk print failed:', err);
      toast.dismiss(toastId);
      toast.error('پرنٹ میں کوئی مسئلہ آیا۔ براہ کرم دوبارہ کوشش کریں۔');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center"
        >
          <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Package className="w-10 h-10 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ShipFlow</h1>
          <p className="text-gray-500 mb-8">پروفیشنل آرڈر اور اسٹاک مینجمنٹ سسٹم</p>
          <Button onClick={handleLogin} className="w-full py-4 text-lg font-bold">
            گوگل کے ساتھ لاگ ان کریں
          </Button>
        </motion.div>
      </div>
    );
  }

  const isPrimaryAdmin = user.email === 'noorullah03474763055@gmail.com' || user.email === 'noorullah111111111@gmail.com';

  if (!isPrimaryAdmin && userStatus === 'pending') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 dir-rtl text-right">
        <Toaster position="top-right" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5 text-amber-600 animate-pulse">
            <Clock className="w-10 h-10" />
          </div>
          
          <span className="inline-block px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-full mb-3 border border-amber-200">
            منظوری کے لیے زیر التوا (Pending Approval)
          </span>

          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            اکاؤنٹ کی منظوری کا انتظار ہے
          </h2>

          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            السلام علیکم <strong className="text-gray-900">{user.displayName || user.email}</strong>!<br />
            آپ کا اکاؤنٹ کامیابی سے لاگ ان ہو چکا ہے۔ لیکن پہلی مرتبہ استعمال کے لیے ایڈمن (<span className="font-semibold text-indigo-600 dir-ltr inline-block">noorullah03474763055@gmail.com</span>) کی منظوری درکار ہے۔ 
          </p>

          <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100 text-xs space-y-2 text-right">
            <div className="flex justify-between items-center text-gray-500">
              <span>ای میل:</span>
              <span className="font-medium text-gray-800 dir-ltr">{user.email}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500">
              <span>حالت (Status):</span>
              <span className="text-amber-600 font-bold">زیر التوا (Pending)</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-6">
            جیسے ہی ایڈمن آپ کی درخواست منظور کریں گے، آپ ایپ کا سارا ڈیٹا اور تمام فیچرز اپنے الگ جی میل اکاؤنٹ پر استعمال کر سکیں گے۔
          </p>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={() => window.location.reload()} 
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              اسٹیٹس چیک کریں / ریفریش
            </Button>
            <Button 
              variant="outline" 
              onClick={handleLogout} 
              className="w-full text-red-600 hover:bg-red-50 border-red-200 font-bold py-3 rounded-xl cursor-pointer"
            >
              لاگ آؤٹ کریں
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!isPrimaryAdmin && userStatus === 'rejected') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 dir-rtl text-right">
        <Toaster position="top-right" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-5 text-rose-600">
            <UserX className="w-10 h-10" />
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            درخواست مسترد کر دی گئی
          </h2>

          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            معذرت! آپ کے اکاؤنٹ (<span className="font-medium dir-ltr text-gray-800">{user.email}</span>) کے استعمال کی درخواست ایڈمن نے مسترد کر دی ہے۔
          </p>

          <Button 
            variant="outline" 
            onClick={handleLogout} 
            className="w-full text-red-600 hover:bg-red-50 border-red-200 font-bold py-3 rounded-xl cursor-pointer"
          >
            لاگ آؤٹ
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-0 md:pl-64">
      <Toaster position="top-right" />
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 fixed inset-y-0 left-0 z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Package className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">ShipFlow</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
          {isAdmin && (
            <button
              onClick={() => setShowUserApprovalModal(true)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-800 hover:bg-indigo-50 hover:text-indigo-700 transition-all font-bold text-xs cursor-pointer mb-3 border border-indigo-200 bg-indigo-50/60 shadow-2xs"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <span>صارفین کی منظوری</span>
              </div>
              {pendingUsersCount > 0 ? (
                <span className="bg-amber-500 text-slate-950 font-black text-[11px] px-2 py-0.5 rounded-full animate-bounce">
                  {pendingUsersCount} نیا
                </span>
              ) : (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 font-extrabold px-1.5 py-0.5 rounded">ایڈمن</span>
              )}
            </button>
          )}

          <NavItem icon={<LayoutDashboard />} label="ڈیش بورڈ" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<ShoppingCart />} label="آرڈرز" active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} />
          <NavItem icon={<Truck />} label="ٹریکنگ" active={activeTab === 'track'} onClick={() => setActiveTab('track')} />
          <NavItem icon={<Wallet />} label="ادائیگیاں" active={activeTab === 'payments'} onClick={() => setActiveTab('payments')} />
          <NavItem icon={<Package />} label="اسٹاک" active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} />
          <NavItem icon={<FileText />} label="بل بنانے والا" active={activeTab === 'billmaker'} onClick={() => setActiveTab('billmaker')} />
          <NavItem icon={<BookOpen />} label="پرسنل کھاتہ" active={activeTab === 'personal'} onClick={() => setActiveTab('personal')} />
          <NavItem icon={<SettingsIcon />} label="سیٹنگز" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="p-4 border-t border-gray-100 bg-slate-50/50">
          <div 
            onClick={() => setShowAccountModal(true)}
            className="flex items-center gap-3 mb-3 p-2 rounded-xl hover:bg-white border border-transparent hover:border-slate-200 transition-all cursor-pointer group"
            title="اکاؤنٹ کی تفصیلات دیکھنے یا تبدیل کرنے کے لیے کلک کریں"
          >
            <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border border-indigo-200 object-cover shrink-0" alt="User" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="text-sm font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">{user.displayName}</p>
                {isAdmin && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold uppercase">ایڈمن</span>}
              </div>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSwitchAccount}
              className="w-full px-2 py-2 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
              title="دوسرا گوگل اکاؤنٹ لاگ ان کریں"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>سوئچ</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full px-2 py-2 rounded-xl text-xs font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200/80 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
              title="سسٹم سے لاگ آؤٹ کریں"
            >
              <LogOut className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span>لاگ آؤٹ</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Bottom Nav (Mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 flex justify-around p-1 px-1 z-50 shadow-lg text-[10px]">
        <MobileNavItem icon={<LayoutDashboard />} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} label="ڈیش بورڈ" />
        <MobileNavItem icon={<ShoppingCart />} active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} label="آرڈرز" />
        <MobileNavItem icon={<Truck />} active={activeTab === 'track'} onClick={() => setActiveTab('track')} label="ٹریکنگ" />
        <MobileNavItem icon={<Wallet />} active={activeTab === 'payments'} onClick={() => setActiveTab('payments')} label="ادائیگیاں" />
        <MobileNavItem icon={<Package />} active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} label="اسٹاک" />
        <MobileNavItem icon={<FileText />} active={activeTab === 'billmaker'} onClick={() => setActiveTab('billmaker')} label="بلز" />
        <MobileNavItem icon={<BookOpen />} active={activeTab === 'personal'} onClick={() => setActiveTab('personal')} label="کھاتہ" />
        <MobileNavItem icon={<SettingsIcon />} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="سیٹنگز" />
      </nav>

      {/* Mobile Header Bar */}
      <div className="md:hidden bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center justify-between sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
            <Package className="w-5 h-5" />
          </div>
          <span className="font-bold text-gray-900 text-base">ShipFlow</span>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowUserApprovalModal(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs cursor-pointer shadow-2xs"
            >
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>صارفین</span>
              {pendingUsersCount > 0 && (
                <span className="bg-amber-500 text-slate-950 font-black text-[10px] px-1.5 py-0.2 rounded-full animate-bounce">
                  {pendingUsersCount}
                </span>
              )}
            </button>
          )}

          {/* Quick Account Switch / Logout Button on Mobile */}
          <button
            onClick={() => setShowAccountModal(true)}
            className="flex items-center gap-1.5 p-1 pr-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold text-xs cursor-pointer transition-all shadow-2xs"
            title="اکاؤنٹ سوئچ یا لاگ آؤٹ کریں"
          >
            <img 
              src={user.photoURL || ''} 
              className="w-6 h-6 rounded-full border border-indigo-400 object-cover shrink-0" 
              alt="User" 
            />
            <span className="max-w-[70px] truncate text-[11px] font-bold text-slate-700">{user.displayName?.split(' ')[0] || 'اکاؤنٹ'}</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 rotate-90 shrink-0" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="p-4 md:p-8 max-w-7xl mx-auto overflow-x-hidden">
        {connectionError && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-100 border border-red-200 rounded-xl flex items-center gap-3 text-red-800"
          >
            <AlertTriangle className="w-5 h-5" />
            <div className="flex-1">
              <p className="font-bold">Connection Error</p>
              <p className="text-sm">{connectionError}</p>
            </div>
            <Button 
              variant="ghost" 
              className="text-red-800 hover:bg-red-200 h-auto py-1" 
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </motion.div>
        )}
        {(activeTab === 'dashboard' || activeTab === 'inventory') && !dismissedLowStockAlert && lowStockProducts > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-3 text-red-700 min-w-0">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="font-medium truncate text-xs sm:text-sm md:text-base">{lowStockProducts} پروڈکٹس کا اسٹاک کم ہے! (Low Stock)</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" className="text-red-700 hover:bg-red-100 h-auto py-1 px-2 font-bold text-xs sm:text-sm" onClick={() => { setActiveTab('inventory'); setShowLowStockOnly(true); }}>
                چیک کریں
              </Button>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-red-700 hover:bg-red-100" onClick={() => setDismissedLowStockAlert(true)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <Dashboard 
              orders={orders} 
              products={products} 
              filterType={filterType}
              setFilterType={setFilterType}
              filterValue={filterValue}
              setFilterValue={setFilterValue}
              availablePeriods={availablePeriods}
              filteredOrders={filteredOrders}
              totalRevenue={totalRevenue}
              totalProfit={totalProfit}
              profitMargin={profitMargin}
              partnerStats={partnerStats}
              stockSummary={stockSummary}
              downloadReport={downloadReport}
              downloadPartnerReport={downloadPartnerReport}
              setViewingOrder={setViewingOrder}
            />
          )}
          {activeTab === 'track' && (
            <div className="py-8">
               <ParcelTracker initialId={trackingSearchId} initialCarrier={trackingSearchCarrier} />
            </div>
          )}
          {activeTab === 'orders' && (
            <Orders 
              orders={orders} 
              products={products} 
              setViewingOrder={setViewingOrder} 
              setShowOrderModal={setShowOrderModal} 
              setShowBulkOrderModal={setShowBulkOrderModal} 
              setEditingOrder={setEditingOrder}
              customerFilter={customerFilter} 
              setCustomerFilter={setCustomerFilter} 
              bulkPrint={bulkPrint} 
              updateOrderStatus={updateOrderStatus} 
              togglePaymentStatus={togglePaymentStatus} 
              settings={settings}
              filterType={filterType}
              setFilterType={setFilterType}
              filterValue={filterValue}
              setFilterValue={setFilterValue}
              availablePeriods={availablePeriods}
              downloadReport={downloadReport}
              onTrackOrder={(id: string, carrier?: string) => {
                setTrackingSearchId(id);
                setTrackingSearchCarrier(carrier || '');
                setActiveTab('track');
              }}
              onRecordResult={(res: MetaSendResult) => {
                setWhatsappLogs(prev => [...prev, res]);
                setLatestInspectResult(res);
              }}
              onOpenInspector={() => setShowInspectorModal(true)}
              whatsappLogsCount={whatsappLogs.length}
            />
          )}
          {activeTab === 'payments' && (
            <PaymentsView 
              orders={orders} 
              togglePaymentStatus={togglePaymentStatus} 
              togglePartnerPaidStatus={togglePartnerPaidStatus}
              downloadPartnerReport={downloadPartnerReport}
              filterType={filterType}
              setFilterType={setFilterType}
              filterValue={filterValue}
              setFilterValue={setFilterValue}
              availablePeriods={availablePeriods}
            />
          )}
          {activeTab === 'inventory' && (
            <Inventory 
              products={products} 
              orders={orders}
              setEditingProduct={setEditingProduct} 
              setShowProductModal={setShowProductModal} 
              showLowStockOnly={showLowStockOnly} 
              setShowLowStockOnly={setShowLowStockOnly}
              filterType={filterType}
              setFilterType={setFilterType}
              filterValue={filterValue}
              setFilterValue={setFilterValue}
              availablePeriods={availablePeriods}
              downloadStockReport={downloadStockReport}
              stockLogs={stockLogs}
            />
          )}
          {activeTab === 'billmaker' && (
            <BillMakerView products={products} settings={settings} bills={bills} orders={orders} />
          )}
          {activeTab === 'personal' && (
            <PersonalLedgerView />
          )}
          {activeTab === 'settings' && (
            <SettingsView 
              settings={settings} 
              user={user}
              role={role}
              onLogout={handleLogout}
              onSwitchAccount={handleSwitchAccount}
              onRecordResult={(res) => {
                setWhatsappLogs(prev => [...prev, res]);
                setLatestInspectResult(res);
              }}
              onOpenInspector={() => setShowInspectorModal(true)}
              whatsappLogsCount={whatsappLogs.length}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Meta WhatsApp Inspector Modal */}
      {showInspectorModal && (
        <MetaWhatsAppInspectorModal
          isOpen={showInspectorModal}
          onClose={() => setShowInspectorModal(false)}
          inspectResult={latestInspectResult}
          logs={whatsappLogs}
          onRetryTemplate={(phone) => {
            if (settings?.metaPhoneNumberId && settings?.metaAccessToken) {
              sendMetaWhatsAppMessage({
                phoneNumberId: settings.metaPhoneNumberId,
                accessToken: settings.metaAccessToken,
                recipientPhone: phone,
                messageText: 'hello_world',
                messageType: 'template',
                templateName: settings?.metaTemplateName || 'hello_world',
                templateLanguage: settings?.metaTemplateLanguage || 'en_US',
              }).then(res => {
                setWhatsappLogs(prev => [...prev, res]);
                setLatestInspectResult(res);
                if (res.success) {
                  toast.success('ٹیمپلیٹ میسج کامیابی سے بھیج دیا گیا! ✅');
                } else {
                  toast.error(`ناکامی: ${res.errorMessage}`);
                }
              });
            }
          }}
          onOpenDirectWeb={(phone) => {
            window.open(getWhatsAppLink(phone, 'سلام'), '_blank');
          }}
        />
      )}

      {/* Modals */}
      {showProductModal && (
        <ProductModal 
          product={editingProduct} 
          products={products}
          onClose={() => { setShowProductModal(false); setEditingProduct(null); }} 
        />
      )}
      {(showOrderModal || editingOrder !== null) && (
        <OrderModal 
          products={products} 
          settings={settings}
          existingOrder={editingOrder}
          orders={orders}
          onClose={() => { setShowOrderModal(false); setEditingOrder(null); }} 
        />
      )}
      {showBulkOrderModal && (
        <BulkOrderModal 
          orders={orders}
          onClose={() => setShowBulkOrderModal(false)}
        />
      )}
      {viewingOrder && (
        <OrderDetailModal 
          order={viewingOrder} 
          settings={settings}
          onClose={() => setViewingOrder(null)} 
          setCustomerFilter={setCustomerFilter}
          setActiveTab={setActiveTab}
          updateOrderStatus={updateOrderStatus}
        />
      )}

      <UserApprovalModal 
        isOpen={showUserApprovalModal} 
        onClose={() => setShowUserApprovalModal(false)} 
        currentAdminEmail={user?.email} 
      />

      <AccountModal
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        user={user}
        role={role}
        onLogout={handleLogout}
        onSwitchAccount={handleSwitchAccount}
      />

      <Chatbot orders={orders} products={products} />
    </div>
  );
}

// --- Sub-Views ---

function NavItem({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 group relative',
        'font-semibold text-sm active:scale-95',
        active 
          ? 'bg-indigo-600 text-white shadow-[0_8px_16px_-4px_rgba(99,102,241,0.35)]' 
          : 'text-gray-500 hover:bg-slate-50 hover:text-gray-900 border border-transparent'
      )}
    >
      <span className={cn(
        'transition-transform duration-200 group-hover:scale-110',
        active ? 'text-white' : 'text-gray-400 group-hover:text-indigo-600'
      )}>
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
      </span>
      <span className="font-semibold">{label}</span>
      
      {active && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white shadow-xs"></span>
      )}
    </button>
  );
}

function MobileNavItem({ icon, active, onClick, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-2 rounded-xl transition-all duration-200 outline-none select-none shrink-0 min-w-[50px] active:scale-90',
        active ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
      )}
    >
      <div className={cn(
        'p-1.5 rounded-xl transition-all duration-300',
        active ? 'bg-indigo-50/80 scale-105 shadow-sm' : 'bg-transparent'
      )}>
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
      </div>
      {label && <span className="text-[9px] font-bold tracking-tight uppercase">{label}</span>}
    </button>
  );
}

function Dashboard({ 
  orders, 
  products, 
  filterType,
  setFilterType,
  filterValue,
  setFilterValue,
  availablePeriods,
  filteredOrders,
  totalRevenue,
  totalProfit,
  profitMargin,
  partnerStats,
  stockSummary,
  downloadReport,
  downloadPartnerReport,
  setViewingOrder 
}: any) {
  const pendingOrders = filteredOrders.filter((o: Order) => o.status === 'Pending').length;
  const pendingPaymentsCount = filteredOrders.filter((o: Order) => !o.paymentReceived && o.status !== 'Cancelled' && o.status !== 'Returned').length;
  const pendingPaymentsAmount = filteredOrders.filter((o: Order) => !o.paymentReceived && o.status !== 'Cancelled' && o.status !== 'Returned').reduce((sum: number, o: Order) => sum + (o.totalAmount || 0), 0);

  // Separate calculations for each courier
  const postPendingOrders = filteredOrders.filter((o: Order) => !o.paymentReceived && o.status !== 'Cancelled' && o.status !== 'Returned' && mapCarrierToCourier(o.carrier, o.trackingNumber) === 'pakpost');
  const postPendingCount = postPendingOrders.length;
  const postPendingAmount = postPendingOrders.reduce((sum: number, o: Order) => sum + (o.totalAmount || 0), 0);

  const leopardsPendingOrders = filteredOrders.filter((o: Order) => !o.paymentReceived && o.status !== 'Cancelled' && o.status !== 'Returned' && mapCarrierToCourier(o.carrier, o.trackingNumber) === 'leopards');
  const leopardsPendingCount = leopardsPendingOrders.length;
  const leopardsPendingAmount = leopardsPendingOrders.reduce((sum: number, o: Order) => sum + (o.totalAmount || 0), 0);

  const tcsPendingOrders = filteredOrders.filter((o: Order) => !o.paymentReceived && o.status !== 'Cancelled' && o.status !== 'Returned' && mapCarrierToCourier(o.carrier, o.trackingNumber) === 'tcs');
  const tcsPendingCount = tcsPendingOrders.length;
  const tcsPendingAmount = tcsPendingOrders.reduce((sum: number, o: Order) => sum + (o.totalAmount || 0), 0);

  const calculateActualProfit = (order: Order) => {
    if (order.status === 'Returned') return -(order.deliveryCharges || 0);
    if (order.status === 'Cancelled') return 0;
    return order.totalProfit || 0;
  };

  const getChartData = () => {
    if (filterType === 'Month') {
      const daysInMonth = new Date(parseInt(filterValue.split('-')[0]), parseInt(filterValue.split('-')[1]), 0).getDate();
      return Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${filterValue}-${day.toString().padStart(2, '0')}`;
        const dayOrders = filteredOrders.filter((o: Order) => format(new Date(o.createdAt), 'yyyy-MM-dd') === dateStr);
        return {
          name: day.toString(),
          revenue: dayOrders.reduce((sum: number, o: Order) => o.status === 'Returned' ? sum : sum + (o.totalAmount || 0), 0),
          profit: dayOrders.reduce((sum: number, o: Order) => sum + calculateActualProfit(o), 0),
        };
      });
    } else if (filterType === 'Year') {
      return Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const monthStr = `${filterValue}-${month.toString().padStart(2, '0')}`;
        const monthOrders = filteredOrders.filter((o: Order) => format(new Date(o.createdAt), 'yyyy-MM') === monthStr);
        return {
          name: format(new Date(monthStr + '-01'), 'MMM'),
          revenue: monthOrders.reduce((sum: number, o: Order) => o.status === 'Returned' ? sum : sum + (o.totalAmount || 0), 0),
          profit: monthOrders.reduce((sum: number, o: Order) => sum + calculateActualProfit(o), 0),
        };
      });
    } else if (filterType === 'Week') {
      return Array.from({ length: 7 }, (_, i) => {
        // This is a bit complex for weeks, let's just show daily for the week
        const date = addDays(startOfWeek(parseISO(filterValue + '-1'), { weekStartsOn: 1 }), i);
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayOrders = filteredOrders.filter((o: Order) => format(new Date(o.createdAt), 'yyyy-MM-dd') === dateStr);
        return {
          name: format(date, 'EEE'),
          revenue: dayOrders.reduce((sum: number, o: Order) => o.status === 'Returned' ? sum : sum + (o.totalAmount || 0), 0),
          profit: dayOrders.reduce((sum: number, o: Order) => sum + calculateActualProfit(o), 0),
        };
      });
    }
    return [];
  };

  const chartData = getChartData();
  
  const carrierData = useMemo(() => {
    const counts = filteredOrders.reduce((acc: any, o: Order) => {
      const carrier = o.carrier || 'Pakistan Post';
      acc[carrier] = (acc[carrier] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredOrders]);

  const COLORS = ['#4f46e5', '#ef4444', '#f97316'];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 max-w-full overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">ڈیش بورڈ</h2>
          
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1">
            <select
              value={filterType}
              onChange={(e) => {
                const type = e.target.value as any;
                setFilterType(type);
                if (type === 'All Time') setFilterValue('All');
                else if (type === 'Year') setFilterValue(format(new Date(), 'yyyy'));
                else if (type === 'Month') setFilterValue(format(new Date(), 'yyyy-MM'));
                else if (type === 'Week') setFilterValue(format(new Date(), "yyyy-'W'II"));
                else if (type === 'Day') setFilterValue(format(new Date(), 'yyyy-MM-dd'));
              }}
              className="text-[10px] sm:text-sm font-medium focus:outline-none bg-transparent"
            >
              <option value="All Time">All Time</option>
              <option value="Year">Yearly</option>
              <option value="Month">Monthly</option>
              <option value="Week">Weekly</option>
              <option value="Day">Daily</option>
            </select>

            {filterType !== 'All Time' && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="text-[10px] sm:text-sm font-medium focus:outline-none bg-transparent border-l border-gray-200 pl-2"
              >
                {filterType === 'Year' && availablePeriods.years.map((y: string) => <option key={y} value={y}>{y}</option>)}
                {filterType === 'Month' && availablePeriods.months.map((m: string) => <option key={m} value={m}>{format(new Date(m + '-01'), 'MMM yyyy')}</option>)}
                {filterType === 'Week' && availablePeriods.weeks.map((w: string) => <option key={w} value={w}>{w}</option>)}
                {filterType === 'Day' && availablePeriods.days.map((d: string) => <option key={d} value={d}>{format(new Date(d), 'MMM dd, yyyy')}</option>)}
              </select>
            )}
          </div>

          <Button variant="secondary" onClick={downloadReport} className="flex items-center gap-1.5 h-8 sm:h-10 px-2 sm:px-4 text-[10px] sm:text-sm">
            <Download className="w-3 h-3 sm:w-4 h-4" />
            <span className="hidden xs:inline">رپورٹ (Report)</span>
            <span className="xs:hidden">پی ڈی ایف</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[10px] sm:text-sm text-gray-500 bg-white px-2 py-1 rounded-lg border border-gray-100 w-fit self-end sm:self-auto">
          <Clock className="w-3 h-3 sm:w-4 h-4" />
          اپڈیٹ: {format(new Date(), 'HH:mm')}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
        <StatCard label="کل آمدنی" value={formatCurrency(totalRevenue)} icon={<TrendingUp className="text-emerald-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} color="bg-emerald-50" />
        <StatCard label="کل منافع" value={formatCurrency(totalProfit)} icon={<CheckCircle2 className="text-indigo-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} color="bg-indigo-50" />
        <StatCard label="زیر التواء آرڈرز" value={pendingOrders} icon={<Clock className="text-amber-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} color="bg-amber-50" />
        <StatCard 
          label="پوسٹ آفس بقایا" 
          value={formatCurrency(postPendingAmount)} 
          subtitle={`${postPendingCount} آرڈرز (Pending)`}
          icon={<Wallet className="text-orange-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} 
          color="bg-orange-50" 
        />
        <StatCard 
          label="لیپرڈ بقایا" 
          value={formatCurrency(leopardsPendingAmount)} 
          subtitle={`${leopardsPendingCount} آرڈرز (Pending)`}
          icon={<Wallet className="text-red-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} 
          color="bg-red-50" 
        />
        <StatCard 
          label="TCS بقایا" 
          value={formatCurrency(tcsPendingAmount)} 
          subtitle={`${tcsPendingCount} آرڈرز (Pending)`}
          icon={<Wallet className="text-blue-600 w-3.5 h-3.5 sm:w-5 sm:h-5" />} 
          color="bg-blue-50" 
        />
      </div>

      <Card className="p-6">
          <h3 className="text-lg font-bold mb-6">کارکردگی کا جائزہ (Performance Overview)</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" fillOpacity={1} fill="url(#colorRev)" strokeWidth={3} />
                <Area type="monotone" dataKey="profit" stroke="#10b981" fillOpacity={0} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 p-6">
          <h3 className="text-lg font-bold mb-6 font-urdu">کورئیر کی تفصیل (Carrier Coverage)</h3>
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={carrierData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {carrierData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-4">
            {carrierData.map((d: any, i: number) => (
              <div key={d.name} className="flex items-center justify-between text-xs font-medium">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                  <span className="text-gray-600">{d.name}</span>
                </div>
                <span className="text-gray-900 font-bold">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2 p-6">
          <h3 className="text-lg font-bold mb-6">اسٹاک کی تفصیل (فروخت شدہ)</h3>
          
          {/* Mobile view */}
          <div className="md:hidden space-y-4">
            {stockSummary.map((item: any) => (
              <div key={item.id} className="p-4 border border-gray-100 rounded-xl bg-gray-50 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-900">{item.name}</span>
                  <span className="font-bold text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full text-xs">{item.quantity} فروخت</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">کل خرچ:</span>
                  <span className="text-gray-600">{formatCurrency(item.totalCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">کل آمدنی:</span>
                  <span className="font-bold text-emerald-600">{formatCurrency(item.totalAmount)}</span>
                </div>
              </div>
            ))}
            {stockSummary.length === 0 && (
              <p className="py-4 text-center text-gray-500 text-sm">No stock data for this period</p>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="pb-3 text-right">پروڈکٹ</th>
                  <th className="pb-3 text-center">تعداد</th>
                  <th className="pb-3 text-right">کل خرچ</th>
                  <th className="pb-3 text-right">کل آمدنی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stockSummary.map((item: any) => (
                  <tr key={item.id} className="text-sm hover:bg-gray-50 transition-colors">
                    <td className="py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="py-4 text-center font-bold text-indigo-600">{item.quantity}</td>
                    <td className="py-4 text-right text-gray-600">{formatCurrency(item.totalCost)}</td>
                    <td className="py-4 text-right font-bold text-emerald-600">{formatCurrency(item.totalAmount)}</td>
                  </tr>
                ))}
                {stockSummary.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-500">No stock data for this period</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-6">حالیہ آرڈرز</h3>
          <div className="space-y-4">
            {orders.slice(0, 5).map((order: Order) => (
              <div 
                key={order.id} 
                className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => setViewingOrder(order)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <ShoppingCart className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{order.customerName}</p>
                    <p className="text-xs text-gray-500">{format(new Date(order.createdAt), 'dd MMM, HH:mm')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-indigo-600">{formatCurrency(order.totalAmount)}</p>
                  <Badge status={order.status}>{order.status === 'Pending' ? 'زیر التواء' : order.status === 'Shipped' ? 'روانہ' : order.status === 'Delivered' ? 'پہنچ گیا' : order.status === 'Cancelled' ? 'کینسل' : order.status}</Badge>
                </div>
              </div>
            ))}
            {orders.length === 0 && <p className="text-center text-gray-500 py-8">ابھی کوئی آرڈر نہیں ہے</p>}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-bold mb-6">پارٹنر کے منافع کی تفصیل</h3>
        
        {/* Mobile View */}
        <div className="md:hidden space-y-4">
          {partnerStats.map((stat: any) => (
            <div key={stat.name} className="p-4 border border-gray-100 rounded-xl bg-gray-50 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-gray-200 pb-2">
                <span className="font-bold text-gray-900">{stat.name}</span>
                <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-bold">{stat.orderCount} آرڈرز</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">کل منافع:</span>
                <span className="font-bold text-indigo-600">{formatCurrency(stat.totalProfit)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">پارٹنر کا حصہ:</span>
                <span className="font-bold text-emerald-600">{formatCurrency(stat.partnerProfit)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">میرا حصہ:</span>
                <span className="font-bold text-blue-600">{formatCurrency(stat.myProfit)}</span>
              </div>
            </div>
          ))}
          {partnerStats.length === 0 && (
            <p className="py-4 text-center text-gray-500 text-sm">No partner data available</p>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="pb-3 text-right">پارٹنر کا نام</th>
                <th className="pb-3">آرڈرز</th>
                <th className="pb-3">کل منافع</th>
                <th className="pb-3">پارٹنر کا حصہ</th>
                <th className="pb-3">میرا حصہ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {partnerStats.map((stat: any) => (
                <tr key={stat.name} className="text-sm hover:bg-gray-50 transition-colors">
                  <td className="py-4 font-bold text-gray-900">{stat.name}</td>
                  <td className="py-4 text-gray-600">{stat.orderCount}</td>
                  <td className="py-4 font-bold text-indigo-600">{formatCurrency(stat.totalProfit)}</td>
                  <td className="py-4 text-emerald-600 font-medium">{formatCurrency(stat.partnerProfit)}</td>
                  <td className="py-4 text-blue-600 font-medium">{formatCurrency(stat.myProfit)}</td>
                </tr>
              ))}
              {partnerStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">No partner data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </motion.div>
  );
}

function StatCard({ label, value, icon, color, subtitle }: any) {
  return (
    <Card className="flex items-center gap-3 sm:gap-4 p-3 sm:p-5 min-w-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg border border-slate-100 bg-white">
      <div className={cn('w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm', color)}>
        {React.cloneElement(icon, { className: 'w-5 h-5 sm:w-6 sm:h-6' })}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider truncate mb-0.5">{label}</p>
        <p className="text-sm sm:text-2xl font-extrabold text-slate-800 tracking-tight truncate leading-none mt-1">{value}</p>
        {subtitle && (
          <p className="text-[10px] text-gray-500 font-medium mt-1 truncate leading-none">{subtitle}</p>
        )}
      </div>
    </Card>
  );
}

function Orders({ 
  orders, 
  products, 
  setViewingOrder, 
  setShowOrderModal, 
  setShowBulkOrderModal, 
  setEditingOrder,
  customerFilter, 
  setCustomerFilter, 
  bulkPrint, 
  updateOrderStatus, 
  togglePaymentStatus, 
  settings,
  filterType,
  setFilterType,
  filterValue,
  setFilterValue,
  availablePeriods,
  downloadReport,
  onTrackOrder,
  onRecordResult,
  onOpenInspector,
  whatsappLogsCount = 0
}: any) {
  const [search, setSearch] = useState(customerFilter || '');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [partnerFilter, setPartnerFilter] = useState<string>('All');
  
  const partners = useMemo(() => {
    return Array.from(new Set(orders.map((o: any) => o.partnerName).filter((name: any) => name && name.trim() !== '')));
  }, [orders]);

  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [isNotifying, setIsNotifying] = useState(false);
  const [isSyncingLiveTracking, setIsSyncingLiveTracking] = useState(false);
  const [syncingOrderId, setSyncingOrderId] = useState<string | null>(null);
  const [editingTracking, setEditingTracking] = useState<string | null>(null);
  const [newTracking, setNewTracking] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recentlyUpdatedOrders, setRecentlyUpdatedOrders] = useState<Record<string, {
    oldStatus: string;
    newStatus: string;
    oldEvent: string;
    newEvent: string;
    customerName: string;
    trackingNumber: string;
    changedAt: number;
  }>>({});
  const [showSyncReportModal, setShowSyncReportModal] = useState(false);
  const [showBulkMessageModal, setShowBulkMessageModal] = useState(false);
  const [showBulkMoneyOrderModal, setShowBulkMoneyOrderModal] = useState(false);

  const handleSyncLiveTracking = async () => {
    const shippedOrders = orders.filter((o: Order) => o.status === 'Shipped' && o.trackingNumber && o.trackingNumber.trim() !== '');
    if (shippedOrders.length === 0) {
      toast('کوئی "Shipped" آرڈر ٹریکنگ کے لیے موجود نہیں ہے۔');
      return;
    }
    
    setIsSyncingLiveTracking(true);
    setRecentlyUpdatedOrders({}); // Reset previous updates highlight
    let updatedCount = 0;
    const localReport: any = {};
    
    try {
      // Create a copy to prevent parallel fetch issues or rate limiting, batched if possible or sequential.
      for (const order of shippedOrders) {
        setSyncingOrderId(order.id);
        try {
          const targetCourier = mapCarrierToCourier(order.carrier, order.trackingNumber);
          const res = await fetch(`/api/track/${targetCourier}/${order.trackingNumber}`);
          const data = await res.json();
          if (data && data.status && data.status !== "ریکارڈ نہیں ملا (ID چیک کریں)" && data.status !== "معلومات میسر نہیں") {
             const statusTxt = data.status.toLowerCase();
             let newStatus: OrderStatus | null = null;
             
             let isReturned = false;
             
             // 1. Detect direct Return / Undelivered keywords or labels
             if (statusTxt.includes('undelivered') || 
                 statusTxt.includes('return') || 
                 statusTxt.includes('redirection') || 
                 statusTxt.includes('unclaimed') || 
                 statusTxt.includes('refused') || 
                 statusTxt.includes('sent back') || 
                 statusTxt.includes('back to sender') ||
                 statusTxt.includes('rts')) {
                isReturned = true;
             }
             
             // 2. Booking Office Return Heuristic:
             // If the parcel has moved beyond initial booking but is now dispatched to, 
             // or received at, the booking office / sender's delivery area, and the target customer is in another city.
             if (!isReturned && data.bookingOffice && data.deliveryOffice) {
                const bookingClean = data.bookingOffice.toLowerCase().replace('gpo', '').replace('dmo', '').trim();
                const deliveryClean = data.deliveryOffice.toLowerCase().replace('gpo', '').replace('dmo', '').trim();
                const locLower = data.location ? data.location.toLowerCase() : '';
                
                if (bookingClean && deliveryClean && bookingClean !== deliveryClean) {
                   // Verify if the tracking updates refer back to the sender's city/office (e.g. "GUL IQBAL")
                   const isToBookingOffice = statusTxt.includes(bookingClean) || locLower.includes(bookingClean);
                   const isInitialBookingState = statusTxt.includes('booked') || statusTxt.includes('insert') || statusTxt.includes('receive');
                   const isToSenderDelivery = statusTxt.includes('delivery office') && statusTxt.includes(bookingClean);
                   
                   if ((isToBookingOffice && !isInitialBookingState) || isToSenderDelivery) {
                      isReturned = true;
                   }
                }
             }
             
             // 3. Delivered-to-source-city Return Heuristic:
             // If a package is marked delivered, but delivery location matches the sender's region and not the customer's.
             if (!isReturned && (statusTxt.includes('delivered') || statusTxt.includes('delievered'))) {
                if (statusTxt.includes('sender')) {
                   isReturned = true;
                } else if (data.location && order.customerCity) {
                   const locLower = data.location.toLowerCase();
                   const custCityLower = order.customerCity.toLowerCase();
                   const bookingLower = data.bookingOffice ? data.bookingOffice.toLowerCase() : 'karachi';

                   let sourceCity = 'karachi';
                   if (bookingLower.includes('lahore')) sourceCity = 'lahore';
                   else if (bookingLower.includes('islamabad')) sourceCity = 'islamabad';
                   else if (bookingLower.includes('peshawar')) sourceCity = 'peshawar';
                   else if (bookingLower.includes('multan')) sourceCity = 'multan';
                   else if (bookingLower.includes('quetta')) sourceCity = 'quetta';
                   else if (bookingLower.includes('karachi')) sourceCity = 'karachi';

                   if (locLower.includes(sourceCity) && !custCityLower.includes(sourceCity)) {
                      isReturned = true;
                   }
                }
             }

             // Map evaluated state

              // 4. Return to Karachi (Sender City) Heuristic:
              // If the tracking update shows the parcel is heading back to or has arrived in Karachi, 
              // while the customer's city is outside Karachi, and the parcel has moved past its initial booking accepts.
              if (!isReturned && order.customerCity) {
                 const custLower = order.customerCity.toLowerCase();
                 const isCustOutsideKarachi = !custLower.includes('karachi');
                 
                 if (isCustOutsideKarachi) {
                    const locLower = data.location ? data.location.toLowerCase() : '';
                    const statusLower = statusTxt.toLowerCase();
                    const deliveryOfficeLower = data.deliveryOffice ? data.deliveryOffice.toLowerCase() : '';
                    
                    const isInitialAcceptance = statusLower.includes('booked') || 
                                                statusLower.includes('acceptance') || 
                                                statusLower.includes('inserted') ||
                                                (statusLower.includes('received') && statusLower.includes('booking'));
                    
                    if (!isInitialAcceptance) {
                       const matchesInboundKarachi = 
                          statusLower.includes('dispatched to karachi') || 
                          statusLower.includes('received at karachi') || 
                          statusLower.includes('received in karachi') ||
                          statusLower.includes('arrived at karachi') || 
                          statusLower.includes('arrived in karachi') ||
                          statusLower.includes('returned to karachi') ||
                          statusLower.includes('held at karachi') || 
                          statusLower.includes('delivery office karachi') ||
                          ((statusLower.includes('received') || statusLower.includes('arrived') || statusLower.includes('dispatched') || statusLower.includes('held') || statusLower.includes('delivery')) && 
                           locLower.includes('karachi') && 
                           !statusLower.includes('dispatched from'));
                           
                       const hasReturnedDeliveryOffice = deliveryOfficeLower.includes('karachi') && 
                                                         (statusLower.includes('dispatch') || statusLower.includes('receive') || statusLower.includes('arrive') || statusLower.includes('delivery'));
                       
                       if (matchesInboundKarachi || hasReturnedDeliveryOffice) {
                          isReturned = true;
                       }
                    }
                 }
              }

              // Map evaluated state to actual Firestore order status fields
             if (isReturned) {
                newStatus = 'Returned';
             } else if (statusTxt.includes('[money order]')) {
                newStatus = 'Delivered';
             } else if (statusTxt.includes('delivered') || statusTxt.includes('delievered')) {
                newStatus = 'Delivered';
             }
             
             const updates: any = {};
             if (newStatus && newStatus !== order.status) {
                updates.status = newStatus;
             }
             
             if (data.status !== order.lastTrackingEvent || data.location !== order.lastTrackingLocation) {
                updates.lastTrackingEvent = data.status;
                updates.lastTrackingLocation = data.location;
                updates.lastTrackingDate = data.lastUpdate;
             }
             
             if (Object.keys(updates).length > 0) {
                 await updateDoc(doc(db, 'orders', order.id), updates);
                 updatedCount++;
                 localReport[order.id] = {
                   oldStatus: order.status,
                   newStatus: newStatus || order.status,
                   oldEvent: order.lastTrackingEvent || "کوئی معلومات نہیں / No previous info",
                   newEvent: data.status || "کوئی معلومات نہیں / No info",
                   customerName: order.customerName,
                   trackingNumber: order.trackingNumber,
                   changedAt: Date.now()
                 };
             }
          }
        } catch (err: any) {
          console.error(`Failed tracking for ${order.trackingNumber}:`, err.message || err);
        }
      }
      
      if (updatedCount > 0) {
        setRecentlyUpdatedOrders(localReport);
        setShowSyncReportModal(true);
        toast.success(`${updatedCount} آرڈرز کی ٹریکنگ معلومات اور سٹیٹس اپ ڈیٹ ہو گئے۔`);
      } else {
        toast('تمام معلومات اپ ڈیٹڈ ہیں۔ کوئی نیا سٹیٹس نہیں آیا۔');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('ٹریکنگ سنک میں خرابی آئی ہے۔');
    } finally {
      setIsSyncingLiveTracking(false);
      setSyncingOrderId(null);
    }
  };

  const handleUpdateTracking = async (orderId: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { trackingNumber: newTracking });
      setEditingTracking(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const handleBulkStatusUpdate = async (newStatus: OrderStatus) => {
    if (selectedOrders.size === 0) return;
    try {
      const promises = Array.from(selectedOrders).map((id: string) => 
        updateDoc(doc(db, 'orders', id), { status: newStatus })
      );
      await Promise.all(promises);
      setSelectedOrders(new Set());
      alert(`${selectedOrders.size} آرڈرز کا اسٹیٹس "${newStatus}" پر اپ ڈیٹ کر دیا گیا ہے۔`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'orders/bulk');
    }
  };

  const sendWhatsAppMessage = async (phone: string, message: string) => {
    const formattedPhone = phone.replace(/[^0-9]/g, '');
    const cleanPhone = formattedPhone.startsWith('03') ? '92' + formattedPhone.slice(1) : formattedPhone;

    const provider = settings?.whatsappProvider || (settings?.metaPhoneNumberId && settings?.metaAccessToken ? 'meta' : (settings?.ultraMsgInstanceId ? 'ultramsg' : 'manual'));

    if (provider === 'meta' && settings?.metaPhoneNumberId && settings?.metaAccessToken) {
      const result = await sendMetaWhatsAppMessage({
        phoneNumberId: settings.metaPhoneNumberId,
        accessToken: settings.metaAccessToken,
        recipientPhone: phone,
        messageText: message,
        messageType: settings.metaMessageType || 'auto',
        templateName: settings.metaTemplateName || 'hello_world',
        templateLanguage: settings.metaTemplateLanguage || 'en_US',
      });

      if (onRecordResult) onRecordResult(result);

      if (result.success) {
        toast.success(result.urduAdvice || 'Meta Cloud API کے ذریعے واٹس ایپ بھیج دیا گیا! ✅');
        return true;
      } else {
        if (onOpenInspector) onOpenInspector();
        toast.error(result.urduAdvice || `Meta Cloud API Error: ${result.errorMessage}`, { duration: 6000 });
        return false;
      }
    } else if (provider === 'ultramsg' && settings?.ultraMsgInstanceId && settings?.ultraMsgToken) {
      try {
        const url = `https://api.ultramsg.com/${settings.ultraMsgInstanceId}/messages/chat`;
        const data = new URLSearchParams({
          token: settings.ultraMsgToken,
          to: cleanPhone,
          body: message,
          priority: '10'
        });
        const response = await fetch(url, {
          method: 'POST',
          body: data
        });
        const resData = await response.json();
        return (resData.sent === 'true' || !!resData.id);
      } catch (error) {
        console.error('UltraMsg error:', error);
        return false;
      }
    } else {
      // Fallback to manual
      window.open(getWhatsAppLink(phone, message), '_blank');
      return true;
    }
  };

  const handleBulkNotify = async () => {
    const ordersToNotify = selectedOrders.size > 0 
      ? orders.filter((o: Order) => selectedOrders.has(o.id))
      : filteredOrders;
      
    if (ordersToNotify.length === 0) {
      alert('براہ کرم مطلع کرنے کے لیے کم از کم ایک آرڈر منتخب کریں۔');
      return;
    }
    
    setShowBulkMessageModal(true);
  };

  useEffect(() => {
    if (customerFilter) setSearch(customerFilter);
  }, [customerFilter]);

  const calculateActualProfit = (order: Order) => {
    if (order.status === 'Returned') return -(order.deliveryCharges || 0);
    if (order.status === 'Cancelled') return 0;
    return order.totalProfit || 0;
  };

  const filteredOrders = orders.filter((o: Order) => {
    const matchesSearch = (o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.customerPhone.includes(search) ||
      (o.customerPhone2 && o.customerPhone2.includes(search)) ||
      o.trackingNumber.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = (statusFilter === 'All' || o.status === statusFilter);
    const matchesPartner = partnerFilter === 'All' ? true :
                           partnerFilter === 'Direct' ? (!o.partnerName || o.partnerName.trim() === '') :
                           o.partnerName === partnerFilter;
    
    let matchesDate = true;
    if (filterType !== 'All Time') {
      const orderDate = new Date(o.createdAt);
      if (filterType === 'Year') matchesDate = format(orderDate, 'yyyy') === filterValue;
      else if (filterType === 'Month') matchesDate = format(orderDate, 'yyyy-MM') === filterValue;
      else if (filterType === 'Week') matchesDate = format(orderDate, "yyyy-'W'II") === filterValue;
      else if (filterType === 'Day') matchesDate = format(orderDate, 'yyyy-MM-dd') === filterValue;
    }

    return matchesSearch && matchesStatus && matchesPartner && matchesDate;
  });

  const toggleOrderSelection = (orderId: string) => {
    const newSelection = new Set(selectedOrders);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedOrders(newSelection);
  };

  const toggleAllSelection = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map((o: Order) => o.id)));
    }
  };

  const handleBulkPrint = () => {
    let ordersToPrint: Order[] = [];
    if (selectedOrders.size > 0) {
      ordersToPrint = orders.filter((o: Order) => selectedOrders.has(o.id));
    } else {
      // Default to 'Packed' orders if none selected, as requested
      ordersToPrint = orders.filter((o: Order) => o.status === 'Packed');
      if (ordersToPrint.length === 0) {
        alert('No "Packed" orders to print. Please select orders manually or change status to "Packed".');
        return;
      }
    }
    bulkPrint(ordersToPrint);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 max-w-full overflow-hidden"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">آرڈرز</h2>
          {filteredOrders.length > 0 && (
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs sm:text-sm text-gray-500 font-bold">سب منتخب کریں</span>
              <input 
                type="checkbox" 
                checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0}
                onChange={toggleAllSelection}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Controls */}
          <div className="flex items-center gap-2 bg-white px-2 py-1.5 rounded-lg border border-gray-200 shadow-sm">
            <select
              value={filterType}
              onChange={(e) => {
                const newType = e.target.value as any;
                setFilterType(newType);
                if (newType === 'All Time') setFilterValue('All');
                else if (newType === 'Year') setFilterValue(availablePeriods.years[0]);
                else if (newType === 'Month') setFilterValue(availablePeriods.months[0]);
                else if (newType === 'Week') setFilterValue(availablePeriods.weeks[0]);
                else if (newType === 'Day') setFilterValue(availablePeriods.days[0]);
              }}
              className="bg-transparent border-none text-[10px] sm:text-sm font-medium focus:ring-0 cursor-pointer"
            >
              <option value="All Time">All Time</option>
              <option value="Year">Year</option>
              <option value="Month">Month</option>
              <option value="Week">Week</option>
              <option value="Day">Day</option>
            </select>
            {filterType !== 'All Time' && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="bg-transparent border-none text-[10px] sm:text-sm font-medium focus:ring-0 cursor-pointer border-l border-gray-200 pl-2"
              >
                {filterType === 'Year' && availablePeriods.years.map((y: string) => <option key={y} value={y}>{y}</option>)}
                {filterType === 'Month' && availablePeriods.months.map((m: string) => <option key={m} value={m}>{format(new Date(m + '-01'), 'MMM yyyy')}</option>)}
                {filterType === 'Week' && availablePeriods.weeks.map((w: string) => <option key={w} value={w}>{w}</option>)}
                {filterType === 'Day' && availablePeriods.days.map((d: string) => <option key={d} value={d}>{format(new Date(d), 'dd MMM yy')}</option>)}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {selectedOrders.size > 0 && (
              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-2">
                <span className="text-xs font-bold text-indigo-700">{selectedOrders.size} Selected</span>
                <select 
                  onChange={(e) => {
                    if (e.target.value) handleBulkStatusUpdate(e.target.value as OrderStatus);
                    e.target.value = "";
                  }}
                  className="bg-white border border-indigo-200 rounded px-2 py-1 text-xs font-bold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Change Status...</option>
                  <option value="Pending">Pending</option>
                  <option value="Packed">Packed</option>
                  <option value="Shipped">Shipped</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Returned">Returned</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowBulkMoneyOrderModal(true)}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold h-7 px-2.5 rounded shadow-xs flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  منی آرڈر ({selectedOrders.size})
                </button>
              </div>
            )}
            <Button variant="secondary" onClick={downloadReport} className="flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold">
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              رپورٹ
            </Button>
            <Button variant="secondary" onClick={handleBulkPrint} className="flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold">
              <Printer className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              پرنٹ
            </Button>
            <Button 
              variant="secondary" 
              onClick={() => setShowBulkMoneyOrderModal(true)} 
              className="flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border-emerald-200"
            >
              <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 text-emerald-600" />
              بلک منی آرڈر
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleSyncLiveTracking} 
              disabled={isSyncingLiveTracking}
              className={cn("flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200", isSyncingLiveTracking && "opacity-50")}
            >
              <RefreshCw className={cn("w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1", isSyncingLiveTracking && "animate-spin")} />
              {isSyncingLiveTracking ? 'ہو رہا ہے...' : 'لائیو ٹریکنگ سنک'}
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleBulkNotify} 
              disabled={isNotifying}
              className={cn("flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold", isNotifying && "opacity-50")}
            >
              <MessageSquare className={cn("w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1", isNotifying && "animate-pulse")} />
              {isNotifying ? '...' : 'مطلع کریں'}
            </Button>
            <Button onClick={() => setShowBulkOrderModal(true)} variant="secondary" className="flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200">
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1 rotate-180 text-amber-600" />
              بلک اپلوڈ
            </Button>
            <Button onClick={() => setShowOrderModal(true)} className="flex-1 sm:flex-none h-8 sm:h-9 text-[10px] sm:text-xs px-2 font-bold">
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
              نیا آرڈر
            </Button>
          </div>
        </div>
      </div>

      {Object.keys(recentlyUpdatedOrders).length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mb-4 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3 w-full sm:w-auto text-right" dir="rtl">
            <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold animate-pulse shrink-0 shadow-sm">
              ✓
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-900">
                کل {Object.keys(recentlyUpdatedOrders).length} آرڈرز کے اسٹیٹس اور ٹریکنگ معلومات ابھی اپڈیٹ ہوئی ہیں!
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                اپڈیٹ شدہ آرڈرز کو فہرست میں سبز رنگ (Highlighter) میں نمایاں کر دیا گیا ہے۔
              </p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto shrink-0 justify-end" dir="rtl">
            <Button 
              variant="secondary" 
              onClick={() => setShowSyncReportModal(true)} 
              className="flex-1 sm:flex-none h-8 text-xs bg-white text-emerald-700 hover:bg-emerald-100 border-emerald-200 font-bold"
            >
              تفصیلی رپورٹ / View Report
            </Button>
            <Button 
              onClick={() => setRecentlyUpdatedOrders({})} 
              className="flex-1 sm:flex-none h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              صاف کریں / Clear Highlights
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input 
            placeholder="گاہک یا ٹریکنگ نمبر سے تلاش کریں..." 
            className="pl-10 text-right"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
          {(['All', 'Pending', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-all",
                statusFilter === s ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-gray-200 text-gray-600 hover:border-indigo-300"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Partner/Supplier Quick Filter */}
      {partners.length > 0 && (
        <div className="bg-slate-50 p-2 rounded-xl flex flex-wrap items-center gap-2 border border-slate-200/60 shadow-xs" dir="rtl">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mr-2 ml-1">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>مال سپلائر / پارٹنر فلٹر:</span>
          </div>
          <button
            onClick={() => setPartnerFilter('All')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
              partnerFilter === 'All'
                ? "bg-slate-800 border-slate-800 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            سب دکھائیں ({orders.length})
          </button>
          <button
            onClick={() => setPartnerFilter('Direct')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
              partnerFilter === 'Direct'
                ? "bg-slate-800 border-slate-800 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            براہِ راست سیلز ({orders.filter(o => !o.partnerName || o.partnerName.trim() === '').length})
          </button>
          {partners.map((pName: any, idx: number) => {
            const count = orders.filter(o => o.partnerName === pName).length;
            const isSelected = partnerFilter === pName;
            return (
              <button
                key={pName}
                onClick={() => setPartnerFilter(pName)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                  isSelected
                    ? "bg-indigo-600 border-indigo-700 text-white shadow-xs"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-indigo-50"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  idx === 0 ? "bg-purple-500 animate-pulse" : idx === 1 ? "bg-amber-500 animate-pulse" : "bg-blue-500 animate-pulse"
                )} />
                <span>{pName}</span>
                <span className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] ml-0.5",
                  isSelected ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4">
        {filteredOrders.map((order: Order) => (
          <Card key={order.id} className={cn(
            "hover:border-indigo-200 transition-all group relative",
            selectedOrders.has(order.id) && "border-indigo-500 bg-indigo-50/30",
            syncingOrderId === order.id && "border-amber-400 bg-amber-50/40 ring-2 ring-amber-300 shadow-md transition-all duration-300 animate-pulse",
            recentlyUpdatedOrders[order.id] && "border-emerald-500 bg-emerald-50/20 ring-2 ring-emerald-300 shadow-md transition-all duration-500"
          )}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    checked={selectedOrders.has(order.id)}
                    onChange={() => toggleOrderSelection(order.id)}
                    className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 font-bold cursor-pointer" onClick={() => setViewingOrder(order)}>
                    {order.customerName.charAt(0)}
                  </div>
                </div>
                <div className="cursor-pointer flex-1">
                  <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors flex flex-wrap items-center gap-2" onClick={() => setViewingOrder(order)}>
                    {order.customerName}
                    {syncingOrderId === order.id && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white shadow-sm border border-amber-400">
                        <RefreshCw className="w-3 h-3 animate-spin mr-0.5" />
                        <span>ابھی ٹریک ہو رہا ہے... / Syncing...</span>
                      </span>
                    )}
                    {recentlyUpdatedOrders[order.id] && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shadow-sm border border-emerald-500 animate-bounce">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                        <span>تازہ ترین تلاش (اپڈیٹ شدہ) / Just Updated</span>
                      </span>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mt-1">
                    <span className="flex items-center gap-1 shrink-0" onClick={() => setViewingOrder(order)}>
                      <Truck className="w-3 h-3 text-indigo-400" />
                      {order.customerCity || 'No City'}
                    </span>
                    <span className="text-gray-300 shrink-0">•</span>
                    {editingTracking === order.id ? (
                      <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 bg-indigo-50 p-1 rounded-lg border border-indigo-100 shrink-0">
                        <Input 
                          value={newTracking} 
                          onChange={(e: any) => setNewTracking(e.target.value)}
                          className="h-7 text-xs w-24 bg-white"
                          placeholder="Tracking..."
                          autoFocus
                        />
                        <button onClick={() => handleUpdateTracking(order.id)} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingTracking(null)} className="p-1 text-red-600 hover:bg-red-100 rounded-md transition-colors">
                          <Plus className="w-4 h-4 rotate-45" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100 hover:border-indigo-200 hover:bg-white transition-all group/tracking shrink-0">
                        <span className="font-mono text-xs" onClick={() => setViewingOrder(order)}>{order.trackingNumber || 'No Tracking'}</span>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTracking(order.id);
                              setNewTracking(order.trackingNumber || '');
                            }}
                            className="p-1 text-indigo-400 hover:text-indigo-600 transition-colors"
                            title="Edit Tracking Number"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {order.trackingNumber && (
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTrackOrder(order.trackingNumber, order.carrier);
                                }}
                                className="p-1 transition-all flex items-center gap-1 rounded-md px-2 border bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 shrink-0"
                                title="Track inside App"
                              >
                                <Truck className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold">Track App</span>
                              </button>
                              {(() => {
                                const currentCourier = mapCarrierToCourier(order.carrier, order.trackingNumber);
                                let courierUrl = `https://ep.gov.pk/track.asp?trackid=${order.trackingNumber}`;
                                let courierLabel = 'Track Post';
                                let hoverTitle = 'Copy & Track on Pakistan Post';
                                
                                if (currentCourier === 'leopards') {
                                  courierUrl = `https://www.leopardscourier.com/track/${order.trackingNumber}`;
                                  courierLabel = 'Track Leopards';
                                  hoverTitle = 'Copy & Track on Leopards';
                                } else if (currentCourier === 'tcs') {
                                  courierUrl = `https://www.tcs.com.pk/tracking?tracking_number=${order.trackingNumber}`;
                                  courierLabel = 'Track TCS';
                                  hoverTitle = 'Copy & Track on TCS';
                                }

                                return (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Copy to clipboard first
                                      navigator.clipboard.writeText(order.trackingNumber);
                                      setCopiedId(order.id);
                                      setTimeout(() => setCopiedId(null), 2000);
                                      // Then open the website
                                      window.open(courierUrl, '_blank');
                                    }}
                                    className={cn(
                                      "p-1 transition-all flex items-center gap-1 rounded-md px-2 border shrink-0",
                                      copiedId === order.id 
                                        ? "bg-emerald-100 text-emerald-700 border-emerald-200" 
                                        : "bg-emerald-50 text-emerald-500 border-emerald-100 hover:bg-emerald-100"
                                    )}
                                    title={hoverTitle}
                                  >
                                    {copiedId === order.id ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                                    <span className="text-[10px] font-bold">{copiedId === order.id ? 'Copied!' : courierLabel}</span>
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {order.partnerName && (
                      <>
                        <span className="text-gray-300 shrink-0">•</span>
                        {(() => {
                          const pTrimmed = order.partnerName.trim();
                          const pIdx = partners.indexOf(pTrimmed);
                          const bgClass = pIdx === 0 
                            ? "bg-purple-100 text-purple-800 border-purple-200" 
                            : pIdx === 1 
                            ? "bg-amber-100 text-amber-800 border-amber-200" 
                            : "bg-blue-100 text-blue-800 border-blue-200";
                          const dotClass = pIdx === 0 
                            ? "bg-purple-500" 
                            : pIdx === 1 
                            ? "bg-amber-500" 
                            : "bg-blue-500";
                          return (
                            <span 
                              className={cn(
                                "px-2.5 py-0.5 rounded-full text-[10.5px] font-bold flex items-center gap-1.5 shrink-0 shadow-xs border cursor-pointer hover:scale-105 transition-all", 
                                bgClass
                              )} 
                              onClick={() => setViewingOrder(order)}
                            >
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass)} />
                              <span>سپلائر: {order.partnerName}</span>
                            </span>
                          );
                        })()}
                      </>
                    )}
                  </div>
                  {order.lastTrackingEvent && (
                    <div className="flex flex-col sm:flex-row sm:items-start bg-orange-50 border-l-4 border-orange-400 text-orange-800 text-xs mt-2 p-2 rounded max-w-full">
                       <span className="font-semibold ml-1 shrink-0 mb-1 sm:mb-0">معلومات:</span> 
                       <span className="break-words">
                         {order.lastTrackingLocation} — {order.lastTrackingEvent} 
                         {order.lastTrackingDate && <span className="text-orange-600 ml-1 block sm:inline mt-1 sm:mt-0 font-medium whitespace-nowrap">({order.lastTrackingDate})</span>}
                       </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between md:justify-end gap-6">
                <div className="text-right">
                  <p className="font-bold text-gray-900">{formatCurrency(order.totalAmount)}</p>
                  <p className={cn(
                    "text-xs font-medium",
                    calculateActualProfit(order) >= 0 ? "text-emerald-600" : "text-red-600"
                  )}>
                    Profit: {formatCurrency(calculateActualProfit(order))}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative group/status">
                    <Badge status={order.status}>{order.status}</Badge>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover/status:block bg-white border border-gray-100 rounded-lg shadow-xl z-10 p-1 min-w-[120px]">
                      {(['Pending', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as OrderStatus[]).map(s => (
                        <button
                          key={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateOrderStatus(order.id, s);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors",
                            order.status === s ? "bg-indigo-50 text-indigo-600 font-bold" : "hover:bg-gray-50 text-gray-600"
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePaymentStatus(order.id);
                      }}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        order.paymentReceived 
                          ? "text-emerald-600 bg-emerald-50" 
                          : "text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                      )}
                      title={order.paymentReceived ? "Payment Received" : "Mark Payment Received"}
                    >
                      <Wallet className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingOrder(order);
                      }}
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="Edit Order"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const msg = generateCustomerMessage(order);
                        window.open(getWhatsAppLink(order.customerPhone, msg), '_blank');
                      }}
                      className="p-2 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded-lg transition-all"
                      title="WhatsApp Status"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewingOrder(order);
                      }}
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="View Details / Change Status"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {filteredOrders.length === 0 && (
          <div className="text-center py-12">
            <ShoppingCart className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500">No orders found</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showSyncReportModal && (
          <SyncReportModal 
            reports={recentlyUpdatedOrders} 
            onClose={() => setShowSyncReportModal(false)} 
          />
        )}
        {showBulkMessageModal && (
          <BulkMessageModal 
            orders={selectedOrders.size > 0 ? orders.filter((o: Order) => selectedOrders.has(o.id)) : filteredOrders} 
            settings={settings} 
            onClose={() => setShowBulkMessageModal(false)} 
            onRecordResult={onRecordResult}
            onOpenInspector={onOpenInspector}
            whatsappLogsCount={whatsappLogsCount}
          />
        )}
        {showBulkMoneyOrderModal && (
          <BulkMoneyOrderModal
            isOpen={showBulkMoneyOrderModal}
            onClose={() => setShowBulkMoneyOrderModal(false)}
            orders={filteredOrders}
            selectedOrders={selectedOrders}
            settings={settings}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PaymentsView({ 
  orders, 
  togglePaymentStatus, 
  togglePartnerPaidStatus, 
  downloadPartnerReport,
  filterType,
  setFilterType,
  filterValue,
  setFilterValue,
  availablePeriods
}: any) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Received'>('All');
  const [partnerFilter, setPartnerFilter] = useState('All');
  const [courierFilter, setCourierFilter] = useState<'All' | 'pakpost' | 'leopards' | 'tcs'>('All');
  const [activeSubTab, setActiveSubTab] = useState<'couriers' | 'partners'>('couriers');

  // Excel payment upload states
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [loadedWorkbook, setLoadedWorkbook] = useState<any | null>(null);
  const [workbookSheets, setWorkbookSheets] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [parsedTrackingNumbers, setParsedTrackingNumbers] = useState<string[]>([]);
  const [matchedOrdersList, setMatchedOrdersList] = useState<Order[]>([]);
  const [matchedDetailsMap, setMatchedDetailsMap] = useState<Record<string, { matchedDigits: string; rawCell: string; moNo?: string; fileAmount?: number }>>({});
  const [unmatchedTrackingNumbers, setUnmatchedTrackingNumbers] = useState<string[]>([]);
  const [updateStatusToDelivered, setUpdateStatusToDelivered] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResult, setProcessingResult] = useState<{
    successCount: number;
    totalAmount: number;
    updatedOrders: any[];
    unmatchedTrackings: string[];
  } | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  // Core parser for a specific sheet or all sheets
  const processSheetData = (wb: any, targetSheetName: string) => {
    if (!wb) return;

    const sheetsToProcess = targetSheetName === '__ALL_SHEETS__' 
      ? wb.SheetNames 
      : [targetSheetName || wb.SheetNames[0]];

    const matched: Order[] = [];
    const unmatched: string[] = [];
    const matchedOrderIds = new Set<string>();
    const processedUnmatched = new Set<string>();
    const detectedTrackingsList: string[] = [];
    const detailsMap: Record<string, { matchedDigits: string; rawCell: string; moNo?: string; fileAmount?: number }> = {};

    // 1. Build lookup tables for existing orders
    const exactTrackingMap = new Map<string, Order[]>();
    const orderFullDigitsMap = new Map<string, Order[]>();
    const orderLast7Map = new Map<string, Order[]>();
    const orderSuffixMap = new Map<string, Order[]>(); // 6-digit suffix fallback

    orders.forEach((o: Order) => {
      if (o.trackingNumber) {
        const trimmedUpper = o.trackingNumber.trim().toUpperCase();
        if (trimmedUpper) {
          if (!exactTrackingMap.has(trimmedUpper)) exactTrackingMap.set(trimmedUpper, []);
          exactTrackingMap.get(trimmedUpper)!.push(o);
        }

        const oDigits = o.trackingNumber.replace(/\D/g, '');
        if (oDigits) {
          if (!orderFullDigitsMap.has(oDigits)) orderFullDigitsMap.set(oDigits, []);
          orderFullDigitsMap.get(oDigits)!.push(o);

          if (oDigits.length >= 7) {
            const last7 = oDigits.slice(-7);
            if (!orderLast7Map.has(last7)) orderLast7Map.set(last7, []);
            orderLast7Map.get(last7)!.push(o);
          }

          if (oDigits.length >= 6) {
            const last6 = oDigits.slice(-6);
            if (!orderSuffixMap.has(last6)) orderSuffixMap.set(last6, []);
            orderSuffixMap.get(last6)!.push(o);
          }
        }
      }
    });

    const pickBestOrder = (orderList: Order[]): Order | undefined => {
      const available = orderList.filter(o => !matchedOrderIds.has(o.id));
      if (available.length === 0) return undefined;
      const pending = available.find(o => !o.paymentReceived);
      return pending || available[0];
    };

    sheetsToProcess.forEach((sName: string) => {
      const ws = wb.Sheets[sName];
      if (!ws) return;

      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      if (!rawData || rawData.length === 0) return;

      // Find Header Row and specific columns
      let vplColIdx = -1;
      let moColIdx = -1;
      let amountColIdx = -1;
      let headerRowIndex = -1;
      const skippedColIndices = new Set<number>();

      for (let r = 0; r < Math.min(15, rawData.length); r++) {
        const row = rawData[r];
        if (Array.isArray(row)) {
          let foundAnyHeader = false;
          row.forEach((cell, colIdx) => {
            const cellStr = String(cell || '').trim().toUpperCase();
            if (!cellStr) return;

            // Check for VPL column
            if (
              cellStr.includes('VPL') || 
              cellStr.includes('V.P.L') || 
              cellStr.includes('V.P') || 
              cellStr === 'VP NO' || 
              cellStr === 'VP.NO' || 
              cellStr === 'VP. NO' ||
              cellStr.includes('TRACKING') ||
              cellStr.includes('PARCEL NO')
            ) {
              vplColIdx = colIdx;
              foundAnyHeader = true;
            }

            // Check for MO No column
            if (
              cellStr.includes('MO.') || 
              cellStr.includes('MO NO') || 
              cellStr.includes('M.O') || 
              cellStr.includes('MOS') || 
              cellStr.includes('MONEY ORDER')
            ) {
              moColIdx = colIdx;
              skippedColIndices.add(colIdx);
              foundAnyHeader = true;
            }

            // Check for Amount column
            if (
              cellStr.includes('AMOUNT') || 
              cellStr.includes('AMT') || 
              cellStr === 'TOTAL' || 
              cellStr === 'RS' || 
              cellStr === 'VALUE'
            ) {
              amountColIdx = colIdx;
              skippedColIndices.add(colIdx);
              foundAnyHeader = true;
            }

            // Other skipped headers
            if (
              cellStr.includes('S.NO') || 
              cellStr.includes('SR NO') || 
              cellStr.includes('SR#') || 
              cellStr.includes('S#') ||
              cellStr === 'NO.' || 
              cellStr === 'NO' ||
              cellStr.includes('DATE') ||
              cellStr.includes('POSTING') ||
              cellStr.includes('CITY') ||
              cellStr.includes('OFFICE')
            ) {
              skippedColIndices.add(colIdx);
              foundAnyHeader = true;
            }
          });

          if (foundAnyHeader && headerRowIndex === -1) {
            headerRowIndex = r;
          }
        }
      }

      // If explicit VPL column exists, parse strictly from that column!
      if (vplColIdx >= 0) {
        for (let r = (headerRowIndex >= 0 ? headerRowIndex + 1 : 0); r < rawData.length; r++) {
          const row = rawData[r];
          if (!Array.isArray(row)) continue;

          const rawVplCell = row[vplColIdx];
          if (rawVplCell === null || rawVplCell === undefined) continue;

          let cellStr = String(rawVplCell).trim();
          if (!cellStr) continue;
          if (cellStr.endsWith('.0')) cellStr = cellStr.substring(0, cellStr.length - 2);

          const cellDigits = cellStr.replace(/\D/g, '');
          if (!cellDigits || cellDigits.length < 5) continue;

          const cellUpper = cellStr.toUpperCase();
          const rowMoNo = moColIdx >= 0 && row[moColIdx] ? String(row[moColIdx]).trim() : undefined;
          const rowAmount = amountColIdx >= 0 && row[amountColIdx] ? Number(String(row[amountColIdx]).replace(/[^0-9.]/g, '')) : undefined;

          let matchedOrder: Order | undefined = undefined;
          let matchedDigitsKey = '';

          // 1. Last 7 digits match
          if (cellDigits.length >= 7) {
            const cellLast7 = cellDigits.slice(-7);
            if (orderLast7Map.has(cellLast7)) {
              matchedOrder = pickBestOrder(orderLast7Map.get(cellLast7)!);
              if (matchedOrder) matchedDigitsKey = cellLast7;
            }
          }

          // 2. Full digits match
          if (!matchedOrder && orderFullDigitsMap.has(cellDigits)) {
            matchedOrder = pickBestOrder(orderFullDigitsMap.get(cellDigits)!);
            if (matchedOrder) matchedDigitsKey = cellDigits;
          }

          // 3. Exact tracking string match
          if (!matchedOrder && exactTrackingMap.has(cellUpper)) {
            matchedOrder = pickBestOrder(exactTrackingMap.get(cellUpper)!);
            if (matchedOrder) matchedDigitsKey = cellDigits.slice(-7) || cellDigits;
          }

          // 4. Last 6 digits match fallback
          if (!matchedOrder && cellDigits.length >= 6) {
            const cellLast6 = cellDigits.slice(-6);
            if (orderSuffixMap.has(cellLast6)) {
              matchedOrder = pickBestOrder(orderSuffixMap.get(cellLast6)!);
              if (matchedOrder) matchedDigitsKey = cellLast6;
            }
          }

          if (matchedOrder) {
            matched.push(matchedOrder);
            matchedOrderIds.add(matchedOrder.id);
            detectedTrackingsList.push(matchedOrder.trackingNumber || cellStr);
            detailsMap[matchedOrder.id] = {
              matchedDigits: matchedDigitsKey,
              rawCell: cellStr,
              moNo: rowMoNo,
              fileAmount: rowAmount
            };
          } else {
            if (!processedUnmatched.has(cellStr)) {
              unmatched.push(cellStr);
              processedUnmatched.add(cellStr);
              detectedTrackingsList.push(cellStr);
            }
          }
        }
      } else {
        // Fallback: cell by cell scan
        rawData.forEach((row, rowIdx) => {
          if (rowIdx === headerRowIndex) return;
          if (!Array.isArray(row)) return;

          row.forEach((cell, colIdx) => {
            if (skippedColIndices.has(colIdx)) return;
            if (cell === null || cell === undefined) return;

            let cellStr = String(cell).trim();
            if (!cellStr) return;
            if (cellStr.endsWith('.0')) cellStr = cellStr.substring(0, cellStr.length - 2);

            const cellUpper = cellStr.toUpperCase();
            if (
              cellUpper.startsWith('MOS') || 
              cellUpper.startsWith('SIMOS') || 
              cellUpper.startsWith('SIM OS') ||
              cellUpper.includes('MONEY ORDER')
            ) {
              return;
            }

            const cellDigits = cellStr.replace(/\D/g, '');
            if (!cellDigits || cellDigits.length < 5) return;

            const isPakPhone = cellDigits.length === 11 && cellDigits.startsWith('03');

            let matchedOrder: Order | undefined = undefined;
            let matchedDigitsKey = '';

            if (cellDigits.length >= 7) {
              const cellLast7 = cellDigits.slice(-7);
              if (orderLast7Map.has(cellLast7)) {
                matchedOrder = pickBestOrder(orderLast7Map.get(cellLast7)!);
                if (matchedOrder) matchedDigitsKey = cellLast7;
              }
            }

            if (!matchedOrder && orderFullDigitsMap.has(cellDigits)) {
              matchedOrder = pickBestOrder(orderFullDigitsMap.get(cellDigits)!);
              if (matchedOrder) matchedDigitsKey = cellDigits;
            }

            if (!matchedOrder && exactTrackingMap.has(cellUpper)) {
              matchedOrder = pickBestOrder(exactTrackingMap.get(cellUpper)!);
              if (matchedOrder) matchedDigitsKey = cellDigits.slice(-7) || cellDigits;
            }

            if (matchedOrder) {
              matched.push(matchedOrder);
              matchedOrderIds.add(matchedOrder.id);
              detectedTrackingsList.push(matchedOrder.trackingNumber || cellStr);
              detailsMap[matchedOrder.id] = {
                matchedDigits: matchedDigitsKey,
                rawCell: cellStr
              };
            } else if (!isPakPhone && cellDigits.length >= 7 && cellDigits.length <= 13) {
              const isPureNumberOrCode = /^[A-Z0-9_\-\s]+$/i.test(cellStr);
              if (isPureNumberOrCode && !processedUnmatched.has(cellStr)) {
                unmatched.push(cellStr);
                processedUnmatched.add(cellStr);
                detectedTrackingsList.push(cellStr);
              }
            }
          });
        });
      }
    });

    setParsedTrackingNumbers(detectedTrackingsList);
    setMatchedOrdersList(matched);
    setMatchedDetailsMap(detailsMap);
    setUnmatchedTrackingNumbers(unmatched);

    return { matchedCount: matched.length, unmatchedCount: unmatched.length, totalDetected: detectedTrackingsList.length };
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFile(file);
    setProcessingResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        setLoadedWorkbook(wb);
        setWorkbookSheets(wb.SheetNames || []);

        // Intelligently choose the best sheet:
        // 1. Look for sheet named after user (e.g. NOOR, ULLAH)
        // 2. Or sheet named VPL / DATA
        // 3. Or test which sheet gives maximum matched records
        let bestSheet = wb.SheetNames[0];
        const userSheet = wb.SheetNames.find((s: string) => {
          const upper = s.toUpperCase();
          return upper.includes('NOOR') || upper.includes('ULLAH') || upper.includes('VPL');
        });

        if (userSheet) {
          bestSheet = userSheet;
        } else if (wb.SheetNames.length > 1) {
          let maxMatches = -1;
          wb.SheetNames.forEach((sName: string) => {
            const res = processSheetData(wb, sName);
            if (res && res.matchedCount > maxMatches) {
              maxMatches = res.matchedCount;
              bestSheet = sName;
            }
          });
        }

        setSelectedSheetName(bestSheet);
        const result = processSheetData(wb, bestSheet);

        if (result && result.matchedCount > 0) {
          toast.success(`شیٹ "${bestSheet}" سے ${result.matchedCount} آرڈرز وی پی ایل (VPL) کی بنیاد پر میچ ہو گئے!`);
        } else if (result && result.totalDetected > 0) {
          toast(`شیٹ "${bestSheet}" میں ${result.totalDetected} ٹریکنگ نمبرز پائے گئے لیکن سسٹم میں مماثل نہیں ملے۔ آپ اوپر سے دوسری شیٹ منتخب کر سکتے ہیں۔`, { icon: 'ℹ️' });
        } else {
          toast('فائل لوڈ ہو گئی۔ اگر مطلوبہ ڈیٹا دوسری شیٹ میں ہے تو اوپر دی گئی شیٹس کی لسٹ میں سے منتخب کریں۔', { icon: 'ℹ️' });
        }
      } catch (err) {
        console.error(err);
        toast.error('فائل کو ریڈ کرنے میں خرابی پیش آئی!');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleProcessPayments = async () => {
    if (matchedOrdersList.length === 0) {
      toast.error('پروسیس کرنے کے لیے کوئی مماثل (matched) آرڈرز نہیں ہیں!');
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    let totalAmount = 0;
    const updatedOrders: any[] = [];

    try {
      for (const order of matchedOrdersList) {
        const updateData: any = {
          paymentReceived: true,
          paymentReceivedAt: new Date().toISOString()
        };

        if (updateStatusToDelivered && order.status !== 'Delivered') {
          updateData.status = 'Delivered';
        }

        await updateDoc(doc(db, 'orders', order.id), updateData);

        successCount++;
        totalAmount += order.totalAmount || 0;
        updatedOrders.push({
          id: order.id,
          customerName: order.customerName,
          trackingNumber: order.trackingNumber,
          totalAmount: order.totalAmount,
          partnerName: order.partnerName,
          status: updateStatusToDelivered ? 'Delivered' : order.status
        });
      }

      setProcessingResult({
        successCount,
        totalAmount,
        updatedOrders,
        unmatchedTrackings: unmatchedTrackingNumbers
      });

      // Clear the current file states
      setExcelFile(null);
      setParsedTrackingNumbers([]);
      setMatchedOrdersList([]);
      setUnmatchedTrackingNumbers([]);

      toast.success(`ادائیگیاں کامیابی سے پروسیس ہو گئیں۔ کل رقم: ${formatCurrency(totalAmount)}`);
    } catch (error) {
      console.error(error);
      toast.error('ادائیگیوں کو اپ ڈیٹ کرنے کے دوران کوئی خرابی پیش آئی۔');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadProcessedReport = (result: any) => {
    if (!result || result.updatedOrders.length === 0) return;

    const headers = [
      'آرڈر آئی ڈی (Order ID)',
      'گاہک کا نام (Customer Name)',
      'ٹریکنگ نمبر (Tracking Number)',
      'کل رقم (Total Amount)',
      'پارٹنر (Partner)',
      'سٹیٹس (Status)',
      'ادائیگی سٹیٹس (Payment Status)'
    ];

    const rows = result.updatedOrders.map((o: any) => [
      o.id,
      o.customerName,
      o.trackingNumber,
      o.totalAmount,
      o.partnerName || 'براہِ راست (Direct)',
      o.status,
      'وصول ہو گئی (Received)'
    ]);

    const unmatchedSection: any[] = [];
    if (result.unmatchedTrackings && result.unmatchedTrackings.length > 0) {
      unmatchedSection.push([]);
      unmatchedSection.push(['سسٹم میں نہ ملنے والے ٹریکنگ نمبرز (Not Found Tracking Numbers)']);
      result.unmatchedTrackings.forEach((t: string) => {
        unmatchedSection.push([t]);
      });
    }

    const wsData = [
      headers,
      ...rows,
      [],
      ['مجموعی رقم (Total Sum)', '', '', result.totalAmount],
      ['کل آرڈرز (Total Orders)', '', '', result.successCount],
      ...unmatchedSection
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Processed Orders');

    XLSX.writeFile(wb, `Processed_Payments_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const downloadCourierReport = (courierKey: string) => {
    const courierOrders = orders.filter((o: Order) => {
      if (o.status === 'Returned' || o.status === 'Cancelled') return false;
      const matchesCourier = mapCarrierToCourier(o.carrier, o.trackingNumber) === courierKey;
      
      let matchesPeriod = true;
      if (filterType !== 'All Time') {
        const orderDate = new Date(o.createdAt);
        if (filterType === 'Year') matchesPeriod = format(orderDate, 'yyyy') === filterValue;
        else if (filterType === 'Month') matchesPeriod = format(orderDate, 'yyyy-MM') === filterValue;
        else if (filterType === 'Week') matchesPeriod = format(orderDate, "yyyy-'W'II") === filterValue;
        else if (filterType === 'Day') matchesPeriod = format(orderDate, 'yyyy-MM-dd') === filterValue;
      }
      return matchesCourier && matchesPeriod;
    });

    if (courierOrders.length === 0) {
      toast.error('اس کورئیر کے لیے منتخب وقت میں کوئی آرڈرز نہیں پائے گئے!');
      return;
    }

    const headers = [
      'آرڈر نمبر (Order ID)',
      'گاہک کا نام (Customer Name)',
      'موبائل نمبر (Phone)',
      'شہر (City)',
      'ٹریکنگ نمبر (Tracking Number)',
      'آرڈر کی کل رقم (Total Amount)',
      'ڈلیوری چارجز (Delivery Charges)',
      'آرڈر سٹیٹس (Status)',
      'ادائیگی سٹیٹس (Payment Status)'
    ];

    const rows = courierOrders.map((o: Order) => [
      o.id,
      o.customerName,
      o.customerPhone || '',
      o.customerCity || '',
      o.trackingNumber || '',
      o.totalAmount || 0,
      o.deliveryCharges || 0,
      o.status,
      o.paymentReceived ? 'وصول ہو گئی (Received)' : 'بقایا (Pending)'
    ]);

    const totalAmountSum = courierOrders.reduce((sum: number, o: Order) => sum + (o.totalAmount || 0), 0);
    const totalDeliverySum = courierOrders.reduce((sum: number, o: Order) => sum + (o.deliveryCharges || 0), 0);

    const wsData = [
      [`${courierKey.toUpperCase()} ادائیگیوں اور حساب کتاب کی رپورٹ`],
      [],
      headers,
      ...rows,
      [],
      ['مجموعی آرڈرز (Total Orders)', courierOrders.length],
      ['مجموعی رقم (Total Sum)', totalAmountSum],
      ['مجموعی ڈلیوری چارجز (Total Delivery Charges)', totalDeliverySum],
      ['قابلِ وصول رقم (Expected Cash)', totalAmountSum - totalDeliverySum]
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Courier Report');

    XLSX.writeFile(wb, `${courierKey}_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`${courierKey.toUpperCase()} رپورٹ کامیابی سے ڈاؤن لوڈ ہو گئی۔`);
  };

  const filteredOrders = orders.filter((o: Order) => {
    if (o.status === 'Returned') return false;
    const matchesSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) || 
                         o.trackingNumber.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filter === 'All' ? true : 
                         filter === 'Received' ? o.paymentReceived : !o.paymentReceived;
    const matchesPartner = partnerFilter === 'All' ? true : o.partnerName === partnerFilter;
    const matchesCourier = courierFilter === 'All' ? true : mapCarrierToCourier(o.carrier, o.trackingNumber) === courierFilter;
    
    let matchesDate = true;
    if (filterType !== 'All Time') {
      const orderDate = new Date(o.createdAt);
      if (filterType === 'Year') matchesDate = format(orderDate, 'yyyy') === filterValue;
      else if (filterType === 'Month') matchesDate = format(orderDate, 'yyyy-MM') === filterValue;
      else if (filterType === 'Week') matchesDate = format(orderDate, "yyyy-'W'II") === filterValue;
      else if (filterType === 'Day') matchesDate = format(orderDate, 'yyyy-MM-dd') === filterValue;
    }

    return matchesSearch && matchesStatus && matchesPartner && matchesCourier && matchesDate;
  });

  const partners = Array.from(new Set(orders.filter((o: Order) => o.status !== 'Returned').map((o: Order) => o.partnerName).filter(Boolean)));

  // Calculate profit and stock cost separation metrics
  const paymentStats = useMemo(() => {
    let receivedTotal = 0;
    let receivedProfit = 0;
    let receivedStockCost = 0;
    let receivedDelivery = 0;
    let receivedCount = 0;

    let pendingTotal = 0;
    let pendingProfit = 0;
    let pendingStockCost = 0;
    let pendingDelivery = 0;
    let pendingCount = 0;

    orders.forEach((o: Order) => {
      if (o.status === 'Returned' || o.status === 'Cancelled') return;

      // Apply courier filter
      if (courierFilter !== 'All' && mapCarrierToCourier(o.carrier, o.trackingNumber) !== courierFilter) return;

      // Apply partner filter
      if (partnerFilter !== 'All' && o.partnerName !== partnerFilter) return;

      // Apply search query
      if (search) {
        const matchesSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) || 
                             o.trackingNumber.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return;
      }

      // Apply date filter
      let matchesDate = true;
      if (filterType !== 'All Time') {
        const orderDate = new Date(o.createdAt);
        if (filterType === 'Year') matchesDate = format(orderDate, 'yyyy') === filterValue;
        else if (filterType === 'Month') matchesDate = format(orderDate, 'yyyy-MM') === filterValue;
        else if (filterType === 'Week') matchesDate = format(orderDate, "yyyy-'W'II") === filterValue;
        else if (filterType === 'Day') matchesDate = format(orderDate, 'yyyy-MM-dd') === filterValue;
      }
      if (!matchesDate) return;

      const orderTotal = o.totalAmount || 0;
      const orderProfit = o.totalProfit || 0;
      const orderDelivery = o.deliveryCharges || 0;
      const orderStockCost = o.items?.reduce((sum, item) => sum + ((item.cost || 0) * (item.quantity || 0)), 0) || 0;

      if (o.paymentReceived) {
        receivedTotal += orderTotal;
        receivedProfit += orderProfit;
        receivedStockCost += orderStockCost;
        receivedDelivery += orderDelivery;
        receivedCount += 1;
      } else {
        pendingTotal += orderTotal;
        pendingProfit += orderProfit;
        pendingStockCost += orderStockCost;
        pendingDelivery += orderDelivery;
        pendingCount += 1;
      }
    });

    return {
      received: {
        total: receivedTotal,
        profit: receivedProfit,
        stockCost: receivedStockCost,
        delivery: receivedDelivery,
        count: receivedCount
      },
      pending: {
        total: pendingTotal,
        profit: pendingProfit,
        stockCost: pendingStockCost,
        delivery: pendingDelivery,
        count: pendingCount
      }
    };
  }, [orders, search, partnerFilter, courierFilter, filterType, filterValue]);

  // Courier Settlement Logic
  const courierSettlements = Object.values(orders.reduce((acc: any, o: Order) => {
    if (o.status === 'Returned' || o.status === 'Cancelled') return acc;
    
    let matchesDate = true;
    if (filterType !== 'All Time') {
      const orderDate = new Date(o.createdAt);
      if (filterType === 'Year') matchesDate = format(orderDate, 'yyyy') === filterValue;
      else if (filterType === 'Month') matchesDate = format(orderDate, 'yyyy-MM') === filterValue;
      else if (filterType === 'Week') matchesDate = format(orderDate, "yyyy-'W'II") === filterValue;
      else if (filterType === 'Day') matchesDate = format(orderDate, 'yyyy-MM-dd') === filterValue;
    }
    if (!matchesDate) return acc;

    const courierKey = mapCarrierToCourier(o.carrier, o.trackingNumber);
    
    if (acc[courierKey]) {
      acc[courierKey].totalOrders += 1;
      acc[courierKey].totalAmount += (o.totalAmount || 0);
      acc[courierKey].deliveryCharges += (o.deliveryCharges || 0);

      if (o.paymentReceived) {
        acc[courierKey].receivedOrders += 1;
        acc[courierKey].receivedAmount += (o.totalAmount || 0);
      } else {
        acc[courierKey].pendingOrders += 1;
        acc[courierKey].pendingAmount += (o.totalAmount || 0);
      }
    }

    return acc;
  }, {
    leopards: {
      key: 'leopards',
      name: 'Leopards Courier (لیپرڈ کورئیر)',
      totalOrders: 0,
      pendingOrders: 0,
      receivedOrders: 0,
      totalAmount: 0,
      pendingAmount: 0,
      receivedAmount: 0,
      deliveryCharges: 0,
    },
    pakpost: {
      key: 'pakpost',
      name: 'Pakistan Post (پاکستان پوسٹ)',
      totalOrders: 0,
      pendingOrders: 0,
      receivedOrders: 0,
      totalAmount: 0,
      pendingAmount: 0,
      receivedAmount: 0,
      deliveryCharges: 0,
    },
    tcs: {
      key: 'tcs',
      name: 'TCS Courier (ٹی سی ایس کورئیر)',
      totalOrders: 0,
      pendingOrders: 0,
      receivedOrders: 0,
      totalAmount: 0,
      pendingAmount: 0,
      receivedAmount: 0,
      deliveryCharges: 0,
    }
  }));

  // Partner Settlement Logic
  const partnerSettlements = Object.values(orders.reduce((acc: any, o: Order) => {
    if (o.status === 'Returned') return acc;
    if (!o.partnerName) return acc;
    const partner = o.partnerName.trim();
    
    // Apply date filter to settlements too
    let matchesDate = true;
    if (filterType !== 'All Time') {
      const orderDate = new Date(o.createdAt);
      if (filterType === 'Year') matchesDate = format(orderDate, 'yyyy') === filterValue;
      else if (filterType === 'Month') matchesDate = format(orderDate, 'yyyy-MM') === filterValue;
      else if (filterType === 'Week') matchesDate = format(orderDate, "yyyy-'W'II") === filterValue;
      else if (filterType === 'Day') matchesDate = format(orderDate, 'yyyy-MM-dd') === filterValue;
    }
    
    if (!matchesDate) return acc;

    if (!acc[partner]) {
      acc[partner] = { 
        name: partner, 
        totalOwed: 0, 
        receivedOwed: 0, 
        paid: 0, 
        pendingOrders: 0,
        receivedOrders: 0
      };
    }
    
    const share = o.partnerProfitAmount || 0;
    acc[partner].totalOwed += share;
    
    if (o.paymentReceived) {
      acc[partner].receivedOrders += 1;
      if (o.partnerPaid) {
        acc[partner].paid += share;
      } else {
        acc[partner].receivedOwed += share;
      }
    } else {
      acc[partner].pendingOrders += 1;
    }
    
    return acc;
  }, {}));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-full overflow-x-hidden"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-900">ادائیگیاں اور تصفیہ (Settlements)</h2>
          <Button 
            onClick={() => setShowUploader(!showUploader)}
            className={`text-xs py-1.5 px-3 font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              showUploader 
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700" 
                : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {showUploader ? "اپلوڈر چھپائیں" : "منی آرڈر فائل اپلوڈ کریں"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Controls */}
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-gray-200 shadow-sm">
            <Calendar className="w-4 h-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => {
                const newType = e.target.value as any;
                setFilterType(newType);
                if (newType === 'All Time') setFilterValue('All');
                else if (newType === 'Year') setFilterValue(availablePeriods.years[0]);
                else if (newType === 'Month') setFilterValue(availablePeriods.months[0]);
                else if (newType === 'Week') setFilterValue(availablePeriods.weeks[0]);
                else if (newType === 'Day') setFilterValue(availablePeriods.days[0]);
              }}
              className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer"
            >
              <option value="All Time">تمام وقت (All Time)</option>
              <option value="Year">سالانہ (Year)</option>
              <option value="Month">ماہانہ (Month)</option>
              <option value="Week">ہفتہ وار (Week)</option>
              <option value="Day">روزانہ (Day)</option>
            </select>
            {filterType !== 'All Time' && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer border-l border-gray-200 pl-2"
              >
                {filterType === 'Year' && availablePeriods.years.map((y: string) => <option key={y} value={y}>{y}</option>)}
                {filterType === 'Month' && availablePeriods.months.map((m: string) => <option key={m} value={m}>{format(new Date(m + '-01'), 'MMMM yyyy')}</option>)}
                {filterType === 'Week' && availablePeriods.weeks.map((w: string) => <option key={w} value={w}>{w}</option>)}
                {filterType === 'Day' && availablePeriods.days.map((d: string) => <option key={d} value={d}>{format(new Date(d), 'dd MMM yyyy')}</option>)}
              </select>
            )}
          </div>
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              placeholder="گاہک یا ٹریکنگ نمبر تلاش کریں..." 
              className="pl-10 w-full sm:w-64"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
            />
          </div>
          <select 
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            value={filter}
            onChange={(e: any) => setFilter(e.target.value)}
          >
            <option value="All">تمام ادائیگیاں</option>
            <option value="Pending">بقایا (Pending)</option>
            <option value="Received">موصول (Received)</option>
          </select>
          <select 
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            value={partnerFilter}
            onChange={(e: any) => setPartnerFilter(e.target.value)}
          >
            <option value="All">تمام پارٹنرز</option>
            {partners.map((p: any) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select 
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none text-right"
            value={courierFilter}
            onChange={(e: any) => setCourierFilter(e.target.value)}
          >
            <option value="All">تمام کورئیرز</option>
            <option value="leopards">لیپرڈ کورئیر (Leopards)</option>
            <option value="pakpost">پاکستان پوسٹ (Pakistan Post)</option>
            <option value="tcs">ٹی سی ایس (TCS)</option>
          </select>
        </div>
      </div>

      {/* Excel / CSV Money Order Uploader */}
      <AnimatePresence>
        {showUploader && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white border border-indigo-100 rounded-xl p-6 shadow-sm space-y-6"
          >
            <div className="flex items-start justify-between border-b border-indigo-50 pb-4">
              <div className="text-right w-full">
                <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2 justify-end">
                  <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg text-xs font-mono">XLSX / CSV</span>
                  ایکسل منی آرڈر خودکار وصولی (Bulk Payment Receipt)
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  اپنے منی آرڈر کی ایکسل یا CSV فائل اپلوڈ کریں، سسٹم خودکار طور پر ٹریکنگ نمبر میچ کر کے ادائیگیاں مارک کرے گا۔
                </p>
              </div>
              <div className="bg-indigo-50 p-2.5 rounded-xl ml-3">
                <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Drag and Drop Zone */}
              <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/20 hover:bg-indigo-50/40 rounded-xl p-6 transition-all text-center relative group cursor-pointer">
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleExcelUpload} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-full shadow-sm text-indigo-600 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-gray-700">منی آرڈر کی فائل یہاں ڈراپ کریں یا کلک کریں</p>
                    <p className="text-xs text-gray-400 font-medium">سپورٹڈ فارمیٹس: XLSX, XLS, CSV</p>
                  </div>
                  {excelFile && (
                    <div className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 border border-emerald-100">
                      <Check className="w-3.5 h-3.5" />
                      {excelFile.name}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                    <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-semibold">
                      ✓ وی پی ایل (VPL. No) کالم کی خودکار شناخت
                    </span>
                    <span className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-md font-semibold">
                      ✓ آخری 7 ہندسوں کی تصدیق
                    </span>
                    <span className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-md font-semibold">
                      ✓ سیم او ایس (MOS) مکمل نظر انداز
                    </span>
                  </div>
                </div>
              </div>

              {/* Parsing Options & Summary */}
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <h4 className="font-bold text-sm text-gray-800 text-right">آپشنز اور تفصیلات</h4>
                  
                  {/* Options */}
                  <label className="flex items-center justify-end gap-2.5 cursor-pointer select-none">
                    <span className="text-xs sm:text-sm text-gray-600 font-bold">آرڈرز کا سٹیٹس بھی تبدیل کر کے 'Delivered' کریں</span>
                    <input 
                      type="checkbox" 
                      checked={updateStatusToDelivered} 
                      onChange={(e) => setUpdateStatusToDelivered(e.target.checked)}
                      className="w-4.5 h-4.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </label>

                  {/* Statistics Preview if parsed */}
                  {parsedTrackingNumbers.length > 0 && (
                    <div className="border-t border-slate-200 pt-3 space-y-2 text-right">
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-indigo-600">{parsedTrackingNumbers.length}</span>
                        <span className="text-gray-500">فائل میں پائے گئے ٹریکنگ / VPL نمبرز:</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-emerald-600">{matchedOrdersList.length}</span>
                        <span className="text-gray-500">سسٹم میں موجود مماثل (Matched) آرڈرز:</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-rose-600">{unmatchedTrackingNumbers.length}</span>
                        <span className="text-gray-500">نہ ملنے والے ٹریکنگ نمبرز (توجہ طلب):</span>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                        <span className="font-extrabold text-emerald-700">
                          {formatCurrency(matchedOrdersList.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0))}
                        </span>
                        <span className="font-bold text-gray-700">مجموعی رقم (پیسے وصول):</span>
                      </div>
                    </div>
                  )}
                </div>

                {parsedTrackingNumbers.length > 0 && (
                  <Button 
                    onClick={handleProcessPayments}
                    disabled={isProcessing || matchedOrdersList.length === 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? "پروسیس ہو رہا ہے..." : "وصولیاں رجسٹر کریں (پروسیس کریں)"}
                    <Check className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Multiple Sheets (Tabs) Switcher */}
            {loadedWorkbook && workbookSheets.length > 1 && (
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5 space-y-2 text-right">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-indigo-600 font-medium">
                    کل {workbookSheets.length} شیٹس موجود ہیں
                  </span>
                  <label className="text-xs font-bold text-indigo-900 flex items-center gap-1">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                    ایکسل شیٹ منتخب کریں (Active Sheet):
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  {workbookSheets.map((sName) => {
                    const isSelected = selectedSheetName === sName;
                    return (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => {
                          setSelectedSheetName(sName);
                          processSheetData(loadedWorkbook, sName);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                            : 'bg-white text-gray-700 hover:bg-indigo-100/70 border border-indigo-200'
                        }`}
                      >
                        📄 {sName}
                        {isSelected && <span className="bg-white/20 text-white px-1.5 py-0.2 rounded text-[10px]">فعال</span>}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSheetName('__ALL_SHEETS__');
                      processSheetData(loadedWorkbook, '__ALL_SHEETS__');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedSheetName === '__ALL_SHEETS__'
                        ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                        : 'bg-white text-indigo-700 hover:bg-indigo-100/70 border border-indigo-200'
                    }`}
                  >
                    📂 تمام شیٹس ملا کر (All Sheets)
                  </button>
                </div>
              </div>
            )}

            {/* Matched Orders List Preview */}
            {matchedOrdersList.length > 0 && (
              <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 text-right space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-md">
                    کل {matchedOrdersList.length} آرڈرز میچ ہوئے
                  </span>
                  <h4 className="font-bold text-sm text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    میچ شدہ آرڈرز کی تفصیلی لسٹ (VPL آخری 7 ہندسوں کی بنیاد پر)
                  </h4>
                </div>

                <div className="max-h-60 overflow-y-auto border border-emerald-100 rounded-lg bg-white">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-emerald-50/70 border-b border-emerald-100 text-gray-600 font-bold sticky top-0">
                      <tr>
                        <th className="p-2 text-center w-10">#</th>
                        <th className="p-2">گاہک کا نام</th>
                        <th className="p-2">شہر</th>
                        <th className="p-2">محفوظ شدہ ٹریکنگ</th>
                        <th className="p-2 text-center">میچ شدہ VPL ہندسے</th>
                        <th className="p-2 text-left">رقم</th>
                        <th className="p-2 text-center w-16">ایکشن</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {matchedOrdersList.map((order, idx) => {
                        const info = matchedDetailsMap[order.id];
                        return (
                          <tr key={order.id} className="hover:bg-slate-50">
                            <td className="p-2 text-center text-gray-400 font-bold">{idx + 1}</td>
                            <td className="p-2 font-bold text-gray-900">{order.customerName}</td>
                            <td className="p-2 text-gray-500">{order.customerCity || '-'}</td>
                            <td className="p-2 font-mono text-gray-700">{order.trackingNumber}</td>
                            <td className="p-2 text-center">
                              <span className="bg-emerald-100 text-emerald-800 font-mono font-bold px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                                {info?.matchedDigits || order.trackingNumber?.replace(/\D/g, '').slice(-7)}
                              </span>
                            </td>
                            <td className="p-2 text-left font-extrabold text-emerald-700 font-mono">
                              {formatCurrency(order.totalAmount || 0)}
                            </td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setMatchedOrdersList(matchedOrdersList.filter(o => o.id !== order.id));
                                }}
                                className="text-rose-500 hover:text-rose-700 text-xs font-bold hover:underline cursor-pointer"
                                title="اس کو لسٹ سے نکالیں"
                              >
                                نکالیں
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Unmatched list preview if any */}
            {parsedTrackingNumbers.length > 0 && unmatchedTrackingNumbers.length > 0 && (
              <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-right">
                <h4 className="font-bold text-sm text-rose-800 flex items-center gap-1.5 justify-end">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  توجہ فرمائیں: درج ذیل ٹریکنگ نمبرز ہمارے ریکارڈ میں نہیں ملے!
                </h4>
                <p className="text-xs text-rose-600/80 mt-1">
                  یہ ٹریکنگ نمبرز آپ کی ایکسل فائل میں موجود ہیں لیکن پرسنل کھاتہ یا آرڈرز لسٹ میں درج نہیں ہیں۔ براہِ کرم ان کی تصدیق کر لیں۔
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3 justify-end max-h-32 overflow-y-auto">
                  {unmatchedTrackingNumbers.map((num) => (
                    <span key={num} className="bg-white text-rose-700 border border-rose-200 px-2.5 py-1 rounded font-mono text-xs">
                      {num}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Processing Result Summary & Report Download */}
      {processingResult && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 space-y-6"
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-emerald-200/60 pb-4">
            <Button 
              onClick={() => downloadProcessedReport(processingResult)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-2 px-4 flex items-center gap-2 shadow-md w-full sm:w-auto cursor-pointer"
            >
              پروسیس شدہ فائل ڈاؤن لوڈ کریں (XLSX)
              <Download className="w-4 h-4" />
            </Button>
            <div className="text-center sm:text-right w-full sm:w-auto">
              <h3 className="font-extrabold text-xl text-emerald-900 flex items-center gap-2 justify-center sm:justify-end">
                وصولیاں کامیابی سے درج ہو گئیں!
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </h3>
              <p className="text-xs text-emerald-800 mt-1">
                فائل میں موجود ریکارڈز کامیابی سے اپ ڈیٹ کر دیے گئے ہیں۔ آپ غلطی کی جانچ کے لیے رپورٹ فائل ڈاؤن لوڈ کر سکتے ہیں۔
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-xs border border-emerald-100 text-center">
              <p className="text-xs text-gray-500 font-bold">پروسیس شدہ آرڈرز</p>
              <p className="text-3xl font-extrabold text-emerald-700 mt-2">{processingResult.successCount}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-xs border border-emerald-100 text-center">
              <p className="text-xs text-gray-500 font-bold">مجموعی وصول شدہ رقم</p>
              <p className="text-3xl font-extrabold text-emerald-700 mt-2">{formatCurrency(processingResult.totalAmount)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-xs border border-emerald-100 text-center">
              <p className="text-xs text-gray-500 font-bold">نہ ملنے والے ٹریکنگ نمبرز</p>
              <p className="text-3xl font-extrabold text-rose-600 mt-2">{processingResult.unmatchedTrackings.length}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Profit & Capital Separation Dashboard */}
      <Card className="bg-slate-900 border border-slate-800 text-white p-6 shadow-xl relative overflow-hidden" dir="rtl">
        {/* Background decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="text-right">
              <h3 className="font-extrabold text-xl text-emerald-400 flex items-center gap-2 justify-end">
                <Banknote className="w-6 h-6 text-emerald-400" />
                منافع اور اسٹاک لاگت کا حساب (Profit & Stock Budget Separator)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                وصول شدہ ادائیگیوں میں سے اپنے منافع کو اسٹاک کی رقم (خرید کی قیمت) سے الگ رکھیں تاکہ آپ کا سرمایہ محفوظ رہے اور آپ غلطی سے اسٹاک کے پیسے خرچ نہ کریں۔
              </p>
            </div>
            <div className="bg-slate-800/80 border border-slate-700/50 px-4 py-2 rounded-xl text-right">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">منتخب فلٹر</p>
              <p className="text-xs font-semibold text-indigo-300">
                {filterType === 'All Time' ? 'تمام وقت کا ڈیٹا' : `${filterType} - ${filterValue}`}
                {partnerFilter !== 'All' ? ` | پارٹنر: ${partnerFilter}` : ''}
                {courierFilter !== 'All' ? ` | کورئیر: ${courierFilter.toUpperCase()}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Received / Completed Dues */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-500/30">
                  وصول شدہ رقم (Received Cash Summary)
                </span>
                <span className="text-xs text-slate-400 font-medium">کل {paymentStats.received.count} آرڈرز کے پیسے وصول ہوئے</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Total Received Cash Card */}
                <div className="bg-slate-800/40 border border-slate-800 p-4 rounded-xl text-right hover:border-slate-700 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 text-xs font-bold">مجموعی وصول شدہ رقم</span>
                    <div className="bg-slate-700/50 p-1.5 rounded-lg text-slate-300">
                      <Wallet className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-white">{formatCurrency(paymentStats.received.total)}</p>
                  <p className="text-[10px] text-slate-400 mt-1">کسٹمرز یا کورئیر سے موصول شدہ</p>
                </div>

                {/* Net Profit Card */}
                <div className="bg-emerald-950/20 border border-emerald-900/40 p-4 rounded-xl text-right hover:border-emerald-900/60 transition-colors ring-1 ring-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-emerald-400 text-xs font-extrabold flex items-center gap-1">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-ping inline-block" />
                      آپ کا خالص منافع
                    </span>
                    <div className="bg-emerald-500/20 p-1.5 rounded-lg text-emerald-400">
                      <Sparkles className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-emerald-400">{formatCurrency(paymentStats.received.profit)}</p>
                  <p className="text-[10px] text-emerald-500/80 font-semibold mt-1">آپ کا اپنا بچنے والا خالص منافع</p>
                </div>

                {/* Stock Budget Card */}
                <div className="bg-indigo-950/20 border border-indigo-900/40 p-4 rounded-xl text-right hover:border-indigo-900/60 transition-colors ring-1 ring-indigo-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-indigo-300 text-xs font-extrabold">اسٹاک کا بل / سرمایہ</span>
                    <div className="bg-indigo-500/20 p-1.5 rounded-lg text-indigo-300">
                      <Package className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-indigo-300">{formatCurrency(paymentStats.received.stockCost)}</p>
                  <p className="text-[10px] text-indigo-400 font-bold mt-1">یہ رقم اسٹاک کیلئے الگ رکھیں!</p>
                </div>
              </div>

              {/* Delivery Charges Info */}
              <div className="bg-slate-800/20 border border-slate-800/80 p-3 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-2 text-right">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-slate-300 font-medium">
                    ان آرڈرز کے کل ڈلیوری چارجز: <span className="font-bold text-amber-400">{formatCurrency(paymentStats.received.delivery)}</span>
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">ڈلیوری چارجز پہلے ہی کورئیر اکاؤنٹ سے منہا ہو چکے ہیں۔</p>
              </div>
            </div>

            {/* Column 2: Pending / In-Transit expected money */}
            <div className="bg-slate-800/30 border border-slate-800/80 p-5 rounded-xl space-y-4 text-right">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="bg-amber-500/10 text-amber-400 text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-amber-500/20">
                  زیرِ التواء رقم (Pending / Expected)
                </span>
                <span className="text-xs text-slate-400">کل {paymentStats.pending.count} آرڈرز بقایا ہیں</span>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">کل متوقع رقم:</span>
                  <span className="font-bold text-slate-200">{formatCurrency(paymentStats.pending.total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-500 font-medium">متوقع منافع (آنے والا):</span>
                  <span className="font-extrabold text-emerald-400">{formatCurrency(paymentStats.pending.profit)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-indigo-400">متوقع اسٹاک لاگت:</span>
                  <span className="font-bold text-indigo-300">{formatCurrency(paymentStats.pending.stockCost)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-slate-800 pt-2 text-slate-400">
                  <span>متوقع ڈلیوری چارجز:</span>
                  <span>{formatCurrency(paymentStats.pending.delivery)}</span>
                </div>
              </div>

              <div className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/20 text-center">
                <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                  یہ رقم کورئیر کے پاس زیرِ التواء ہے۔ جیسے ہی ادائیگی وصول ہو گی، یہ اوپر والے وصول شدہ منافع اور اسٹاک لاگت کے سیکشن میں منتقل ہو جائے گی۔
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Sub-Tabs for Settlements */}
      <div className="flex border-b border-gray-200" dir="rtl">
        <button
          onClick={() => setActiveSubTab('couriers')}
          className={`py-3 px-6 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'couriers'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Wallet className="w-4 h-4" />
          کورئیر اکاؤنٹس اور حساب کتاب (Courier Accounts)
        </button>
        <button
          onClick={() => setActiveSubTab('partners')}
          className={`py-3 px-6 text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'partners'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Users className="w-4 h-4" />
          پارٹنر اکاؤنٹس اور تصفیہ (Partner Settlements)
        </button>
      </div>

      {/* Courier Settlement Cards */}
      {activeSubTab === 'couriers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courierSettlements.map((s: any) => {
            const isLeopards = s.key === 'leopards';
            const borderColors = s.key === 'leopards' 
              ? 'border-l-red-500 shadow-md ring-1 ring-red-100 bg-gradient-to-br from-white to-red-50/10' 
              : s.key === 'pakpost' 
                ? 'border-l-orange-500' 
                : 'border-l-blue-500';
            const iconBg = s.key === 'leopards' ? 'bg-red-50' : s.key === 'pakpost' ? 'bg-orange-50' : 'bg-blue-50';
            const iconColor = s.key === 'leopards' ? 'text-red-600' : s.key === 'pakpost' ? 'text-orange-600' : 'text-blue-600';

            return (
              <Card key={s.key} className={`p-5 border-l-4 flex flex-col ${borderColors}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="text-right w-full">
                    <div className="flex items-center gap-1.5 justify-end">
                      {isLeopards && (
                        <span className="bg-red-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded animate-pulse">
                          مقبول
                        </span>
                      )}
                      <h3 className="font-bold text-lg text-gray-900">{s.name}</h3>
                    </div>
                    <p className="text-xs text-gray-500">کورئیر بقایا خلاصہ (Courier Ledger)</p>
                  </div>
                  <div className={`${iconBg} p-2 rounded-lg ml-3`}>
                    <Truck className={`w-5 h-5 ${iconColor}`} />
                  </div>
                </div>

                <div className="space-y-3 flex-1 text-right" dir="rtl">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">کل آرڈرز:</span>
                    <span className="font-bold text-gray-900">{s.totalOrders}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-gray-50 pt-2">
                    <span className="text-gray-500">موصول شدہ آرڈرز:</span>
                    <span className="font-semibold text-emerald-600">
                      {s.receivedOrders} ({formatCurrency(s.receivedAmount)})
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">زیرِ التواء بقایا رقم (Dues):</span>
                    <span className="font-extrabold text-red-600">
                      {formatCurrency(s.pendingAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>زیرِ التواء آرڈرز:</span>
                    <span>{s.pendingOrders}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-gray-50">
                    <span className="text-gray-500">کل متوقع ڈلیوری چارجز:</span>
                    <span className="font-medium text-slate-500">{formatCurrency(s.deliveryCharges)}</span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-2">
                  <Button 
                    variant="outline"
                    className={`w-full text-xs py-1.5 font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                      courierFilter === s.key 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                        : 'bg-white hover:bg-slate-50 text-gray-700'
                    }`}
                    onClick={() => setCourierFilter(courierFilter === s.key ? 'All' : s.key)}
                  >
                    <Search className="w-3.5 h-3.5" />
                    {courierFilter === s.key ? "تمام آرڈرز دکھائیں" : "اس کے آرڈرز کی لسٹ فلٹر کریں"}
                  </Button>
                  <Button 
                    variant="secondary" 
                    className="w-full text-xs py-1.5 font-bold flex items-center justify-center gap-1 cursor-pointer"
                    onClick={() => downloadCourierReport(s.key)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    ایکسل رپورٹ ڈاؤن لوڈ کریں (XLSX)
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Partner Settlement Cards */}
      {activeSubTab === 'partners' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {partnerSettlements.map((s: any) => (
            <Card key={s.name} className="p-5 border-l-4 border-l-indigo-500 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="text-right w-full">
                  <h3 className="font-bold text-lg text-gray-900">{s.name}</h3>
                  <p className="text-xs text-gray-500">پارٹنر تصفیہ خلاصہ (Settlement)</p>
                </div>
                <div className="bg-indigo-50 p-2 rounded-lg ml-3">
                  <Wallet className="w-5 h-5 text-indigo-600" />
                </div>
              </div>
              <div className="space-y-3 flex-1 text-right" dir="rtl">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">موصول شدہ رقم (قابل ادائیگی):</span>
                  <span className="font-bold text-emerald-600">{formatCurrency(s.receivedOwed)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">گاہکوں کی بقایا رقم:</span>
                  <span className="font-medium text-gray-900">{formatCurrency(s.totalOwed - s.receivedOwed - s.paid)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-50">
                  <span className="text-gray-500">کل ادا شدہ رقم:</span>
                  <span className="font-medium text-gray-400">{formatCurrency(s.paid)}</span>
                </div>
                <div className="pt-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>آرڈرز: {s.receivedOrders} موصول / {s.pendingOrders} بقایا</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50">
                <Button 
                  variant="secondary" 
                  className="w-full text-xs py-2 font-bold"
                  onClick={() => downloadPartnerReport(s.name)}
                >
                  رپورٹ ڈاؤن لوڈ کریں
                  <Download className="w-3 h-3 ml-2" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Detailed Payment List */}
      <Card className="overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">آرڈر / گاہک</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">پارٹنر</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">رقم</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">پارٹنر کا حصہ</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">گاہک کی ادائیگی</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 whitespace-nowrap text-right">پارٹنر کی ادائیگی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredOrders.map((o: Order) => (
                <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-bold text-gray-900">{o.customerName}</p>
                    <p className="text-xs text-gray-400 font-mono">{o.trackingNumber}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-600">{o.partnerName || 'Direct'}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-bold text-gray-900">{formatCurrency(o.totalAmount)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="font-medium text-indigo-600">{formatCurrency(o.partnerProfitAmount || 0)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => togglePaymentStatus(o.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all",
                        o.paymentReceived 
                          ? "bg-emerald-100 text-emerald-700" 
                          : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      )}
                    >
                      {o.paymentReceived ? (
                        <><CheckCircle2 className="w-3 h-3" /> موصول ہوگئی</>
                      ) : (
                        <><Clock className="w-3 h-3" /> بقایا ہے</>
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {o.partnerName && (
                      <button
                        onClick={() => togglePartnerPaidStatus(o.id)}
                        disabled={!o.paymentReceived}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                          o.partnerPaid 
                            ? "bg-blue-100 text-blue-700" 
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                      >
                        {o.partnerPaid ? (
                          <><CheckCircle2 className="w-3 h-3" /> پارٹنر کو ادا کردیا</>
                        ) : (
                          <><Wallet className="w-3 h-3" /> ادائیگی کریں</>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Card List */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredOrders.map((o: Order) => (
            <div key={o.id} className="p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-gray-900">{o.customerName}</p>
                  <p className="text-xs text-gray-400 font-mono">{o.trackingNumber}</p>
                  <p className="text-xs text-gray-500 mt-1">Partner: {o.partnerName || 'Direct'}</p>
                  {o.lastTrackingEvent && (
                    <div className="text-[10px] text-orange-600 font-bold mt-1 max-w-[180px] break-words">
                      {o.lastTrackingLocation} — {o.lastTrackingEvent}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{formatCurrency(o.totalAmount)}</p>
                  <p className="text-xs text-indigo-600 font-medium">Share: {formatCurrency(o.partnerProfitAmount || 0)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => togglePaymentStatus(o.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all",
                    o.paymentReceived 
                      ? "bg-emerald-100 text-emerald-700" 
                      : "bg-amber-100 text-amber-700"
                  )}
                >
                  {o.paymentReceived ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {o.paymentReceived ? "Received" : "Pending"}
                </button>
                {o.partnerName && (
                  <button
                    onClick={() => togglePartnerPaidStatus(o.id)}
                    disabled={!o.paymentReceived}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50",
                      o.partnerPaid 
                        ? "bg-blue-100 text-blue-700" 
                        : "bg-gray-100 text-gray-700"
                    )}
                  >
                    {o.partnerPaid ? <CheckCircle2 className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                    {o.partnerPaid ? "Paid" : "Mark Paid"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-gray-500">No payments found</div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function Inventory({ 
  products, 
  orders,
  setEditingProduct, 
  setShowProductModal, 
  showLowStockOnly, 
  setShowLowStockOnly,
  filterType,
  setFilterType,
  filterValue,
  setFilterValue,
  availablePeriods,
  downloadStockReport,
  stockLogs
}: any) {
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('All');

  const suppliers = useMemo(() => {
    return Array.from(new Set(products.map((p: any) => p.supplierName).filter((name: any) => name && name.trim() !== '')));
  }, [products]);

  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [stockLogToDelete, setStockLogToDelete] = useState<any | null>(null);
  const [editingStockLog, setEditingStockLog] = useState<any | null>(null);
  const [showQuickStockModal, setShowQuickStockModal] = useState(false);
  const [showBulkStockModal, setShowBulkStockModal] = useState(false);
  const [quickStockProduct, setQuickStockProduct] = useState<Product | null>(null);
  const [stockLogSortAsc, setStockLogSortAsc] = useState<boolean>(true); // Default: oldest / earliest entry first
  const [isMergingDuplicates, setIsMergingDuplicates] = useState(false);

  const handleManualMergeDuplicates = async () => {
    setIsMergingDuplicates(true);
    try {
      const currentUserId = auth.currentUser?.uid;
      const isPrimaryAdmin = auth.currentUser?.email === 'noorullah03474763055@gmail.com' || auth.currentUser?.email === 'noorullah111111111@gmail.com';
      const q = isPrimaryAdmin 
        ? query(collection(db, 'products'))
        : query(collection(db, 'products'), where('userId', '==', currentUserId));
      const snap = await getDocs(q);
      const allProds = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
      
      const groups = new Map<string, Product[]>();
      allProds.forEach(p => {
        const key = normalizeUrduProductName(p.name);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      });

      let mergedCount = 0;
      for (const [key, group] of groups.entries()) {
        if (group.length > 1) {
          const sorted = [...group].sort((a, b) => {
            if ((b.stock || 0) !== (a.stock || 0)) return (b.stock || 0) - (a.stock || 0);
            if ((b.sellingPrice || 0) !== (a.sellingPrice || 0)) return (b.sellingPrice || 0) - (a.sellingPrice || 0);
            return (a.createdAt || '').localeCompare(b.createdAt || '');
          });
          const primary = sorted[0];
          const duplicates = sorted.slice(1);
          const totalStock = group.reduce((sum, p) => sum + (p.stock || 0), 0);
          const bestCostPrice = group.find(p => (p.costPrice || 0) > 0)?.costPrice || primary.costPrice || 0;
          const bestSellingPrice = group.find(p => (p.sellingPrice || 0) > 0)?.sellingPrice || primary.sellingPrice || 0;
          const bestSupplier = group.find(p => p.supplierName && p.supplierName.trim())?.supplierName || primary.supplierName || '';

          await updateDoc(doc(db, 'products', primary.id), {
            stock: totalStock,
            costPrice: bestCostPrice,
            sellingPrice: bestSellingPrice,
            supplierName: bestSupplier
          });

          for (const dup of duplicates) {
            try {
              const logsSnap = await getDocs(query(collection(db, 'stockLogs'), where('productId', '==', dup.id)));
              if (!logsSnap.empty) {
                const batchLogs = writeBatch(db);
                logsSnap.docs.forEach(lDoc => {
                  batchLogs.update(lDoc.ref, { productId: primary.id });
                });
                await batchLogs.commit();
              }
            } catch (e) {
              console.warn(e);
            }
            await deleteDoc(doc(db, 'products', dup.id));
            mergedCount++;
          }
        }
      }

      if (mergedCount > 0) {
        toast.success(`${mergedCount} ڈپلیکیٹ پروڈکٹس کامیابی سے ضم کر دی گئیں اور اسٹاک یکجا ہو گیا!`);
      } else {
        toast.success('تمام پروڈکٹس پہلے ہی منفرد اور ایک ہی مرتبہ موجود ہیں۔');
      }
    } catch (err: any) {
      console.error('Merge error:', err);
      toast.error('پروڈکٹس ضم کرتے ہوئے مسئلہ پیش آیا: ' + (err?.message || 'خرابی'));
    } finally {
      setIsMergingDuplicates(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const logs = stockLogs.filter((log: any) => {
      const date = new Date(log.createdAt);
      if (filterType === 'All') return true;
      if (filterType === 'Year') return format(date, 'yyyy') === filterValue;
      if (filterType === 'Month') return format(date, 'yyyy-MM') === filterValue;
      if (filterType === 'Week') return format(date, "yyyy-'W'II") === filterValue;
      if (filterType === 'Day') return format(date, 'yyyy-MM-dd') === filterValue;
      return true;
    });

    return [...logs].sort((a: any, b: any) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return stockLogSortAsc ? timeA - timeB : timeB - timeA;
    });
  }, [stockLogs, filterType, filterValue, stockLogSortAsc]);

  const filteredProducts = products.filter((p: Product) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesLowStock = !showLowStockOnly || p.stock <= p.lowStockThreshold;
    const matchesSupplier = supplierFilter === 'All' ? true :
                            supplierFilter === 'Direct' ? (!p.supplierName || p.supplierName.trim() === '') :
                            p.supplierName === supplierFilter;
    return matchesSearch && matchesLowStock && matchesSupplier;
  });

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
      setProductToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    }
  };

  const handleDeleteStockLog = async (log: any) => {
    try {
      const product = products.find((p: Product) => p.id === log.productId);
      if (product) {
        const newStock = Math.max(0, product.stock - log.quantity);
        await updateDoc(doc(db, 'products', product.id), {
          stock: newStock
        });
      }
      await deleteDoc(doc(db, 'stockLogs', log.id));
      setStockLogToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `stockLogs/${log.id}`);
    }
  };

  const totalStockValue = products.reduce((sum, p) => sum + (p.stock * p.sellingPrice), 0);
  const totalStockCost = products.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">اسٹاک (Inventory)</h2>
          <p className="text-sm text-gray-500">اپنی مصنوعات، نیا یا پچھلے مہینے کا اسٹاک اور لاگت کا نظم کریں</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadStockReport(supplierFilter)} title="موجودہ منتخب شدہ دورانیہ کی پی ڈی ایف رپورٹ ڈاؤنلوڈ کریں">
            <Download className="w-4 h-4" />
            اسٹاک رپورٹ ({filterType === 'All' ? 'تمام' : filterType === 'Month' ? format(new Date(filterValue + '-01'), 'MMMM yyyy') : filterValue})
          </Button>
          <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => downloadStockReport(supplierFilter, true)} title="تمام تواریخ کے تمام اسٹاک کا مکمل پی ڈی ایف لیجر ڈاؤنلوڈ کریں">
            <Download className="w-4 h-4 text-indigo-600" />
            تمام ریکارڈز رپورٹ
          </Button>
          <Button 
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            onClick={handleManualMergeDuplicates}
            disabled={isMergingDuplicates}
            title="اگر کوئی پروڈکٹ ایک سے زائد بار ظاہر ہو رہی ہو تو اسے ایک ہی پروڈکٹ میں یکجا کریں"
          >
            <Sparkles className={`w-4 h-4 text-amber-600 ${isMergingDuplicates ? 'animate-spin' : ''}`} />
            {isMergingDuplicates ? 'ضم ہو رہا ہے...' : 'ڈپلیکیٹ پراڈکٹس ضم کریں'}
          </Button>
          <Button 
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200" 
            onClick={() => setShowBulkStockModal(true)}
          >
            <FileSpreadsheet className="w-4 h-4" />
            بلک اسٹاک امپورٹ (ایکسل / لسٹ)
          </Button>
          <Button 
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200" 
            onClick={() => { setQuickStockProduct(null); setShowQuickStockModal(true); }}
          >
            <Plus className="w-4 h-4" />
            + اسٹاک انٹری (پرانا / نیا مال)
          </Button>
          <Button onClick={() => setShowProductModal(true)}>
            <Plus className="w-4 h-4" />
            نئی پروڈکٹ
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-none">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-indigo-100 text-xs font-medium uppercase tracking-wider">کل اسٹاک مالیت (فروخت)</p>
              <h3 className="text-2xl font-bold">{formatCurrency(totalStockValue)}</h3>
            </div>
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-none">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-emerald-100 text-xs font-medium uppercase tracking-wider">کل اسٹاک لاگت (خرید)</p>
              <h3 className="text-2xl font-bold">{formatCurrency(totalStockCost)}</h3>
            </div>
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-amber-500 to-amber-600 text-white border-none">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-amber-100 text-xs font-medium uppercase tracking-wider">کم اسٹاک آئٹمز</p>
              <h3 className="text-2xl font-bold">{products.filter((p: Product) => p.stock <= p.lowStockThreshold).length}</h3>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-indigo-50/50 border-indigo-100">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 space-y-2">
            <Label className="text-indigo-900 font-bold flex items-center justify-end gap-2 text-right">
              اسٹاک رپورٹ کا دورانیہ (Period)
              <Calendar className="w-4 h-4" />
            </Label>
            <div className="grid grid-cols-2 gap-2" dir="rtl">
              <select 
                className="w-full px-4 py-2 rounded-lg border border-indigo-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                value={filterType}
                onChange={(e: any) => {
                  setFilterType(e.target.value);
                  if (e.target.value === 'All') setFilterValue('All Time');
                  else if (e.target.value === 'Year') setFilterValue(availablePeriods.years[0]);
                  else if (e.target.value === 'Month') setFilterValue(availablePeriods.months[0]);
                  else if (e.target.value === 'Week') setFilterValue(availablePeriods.weeks[0]);
                  else if (e.target.value === 'Day') setFilterValue(availablePeriods.days[0]);
                }}
              >
                <option value="All">تمام وقت</option>
                <option value="Year">سالانہ</option>
                <option value="Month">ماہانہ</option>
                <option value="Week">ہفتہ وار</option>
                <option value="Day">روزانہ</option>
              </select>

              {filterType !== 'All' && (
                <select 
                  className="w-full px-4 py-2 rounded-lg border border-indigo-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                  value={filterValue}
                  onChange={(e: any) => setFilterValue(e.target.value)}
                >
                  {filterType === 'Year' && availablePeriods.years.map((y: string) => <option key={y} value={y}>{y}</option>)}
                  {filterType === 'Month' && availablePeriods.months.map((m: string) => <option key={m} value={m}>{format(new Date(m + '-01'), 'MMMM yyyy')}</option>)}
                  {filterType === 'Week' && availablePeriods.weeks.map((w: string) => <option key={w} value={w}>{`Week ${w.split('-W')[1]}, ${w.split('-W')[0]}`}</option>)}
                  {filterType === 'Day' && availablePeriods.days.map((d: string) => <option key={d} value={d}>{format(new Date(d), 'MMM dd, yyyy')}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 pb-2 text-right">
            <p className="text-xs text-indigo-600 font-bold flex items-center justify-end gap-1">
              {filteredLogs.length} اسٹاک انٹریز ملی ہیں۔
              <Package className="w-3 h-3" />
            </p>
            <p className="text-[10px] text-indigo-400 italic">
              * یہ فلٹر صرف اسٹاک رپورٹ پرنٹ کرنے کے لیے ہے۔
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input 
            placeholder="پروڈکٹ کا نام تلاش کریں..." 
            className="pl-10 text-right font-bold"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
          />
        </div>
        <button 
          onClick={() => setShowLowStockOnly(!showLowStockOnly)}
          className={cn(
            "px-4 py-2 rounded-lg border text-sm font-medium transition-all flex items-center gap-2",
            showLowStockOnly ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-gray-200 text-gray-600"
          )}
        >
          <AlertTriangle className="w-4 h-4" />
          صرف کم اسٹاک (Low Stock Only)
        </button>
      </div>

      {/* Supplier Quick Filter */}
      {suppliers.length > 0 && (
        <div className="bg-slate-50 p-2 rounded-xl flex flex-wrap items-center gap-2 border border-slate-200/60 shadow-xs" dir="rtl animate-fade-in">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mr-2 ml-1">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>مال سپلائر فلٹر:</span>
          </div>
          <button
            onClick={() => setSupplierFilter('All')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer",
              supplierFilter === 'All'
                ? "bg-slate-800 border-slate-800 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            سب دکھائیں ({products.length})
          </button>
          <button
            onClick={() => setSupplierFilter('Direct')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer",
              supplierFilter === 'Direct'
                ? "bg-slate-800 border-slate-800 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            بغیر سپلائر ({products.filter(p => !p.supplierName || p.supplierName.trim() === '').length})
          </button>
          {suppliers.map((sName: any, idx: number) => {
            const count = products.filter(p => p.supplierName === sName).length;
            const isSelected = supplierFilter === sName;
            return (
              <button
                key={sName}
                onClick={() => setSupplierFilter(sName)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer",
                  isSelected
                    ? "bg-teal-600 border-teal-700 text-white shadow-xs"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-teal-50"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  idx % 3 === 0 ? "bg-teal-500" : idx % 3 === 1 ? "bg-emerald-500" : "bg-cyan-500"
                )} />
                <span>{sName}</span>
                <span className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] ml-0.5",
                  isSelected ? "bg-teal-500 text-white" : "bg-slate-100 text-slate-600"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4">
        {filteredProducts.map((product: Product) => (
          <Card key={product.id} className="hover:border-indigo-200 transition-all cursor-pointer group" onClick={() => { setEditingProduct(product); setShowProductModal(true); }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center font-bold',
                  product.stock <= product.lowStockThreshold ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'
                )}>
                  <Box className="w-6 h-6" />
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">{product.name}</h3>
                    {product.supplierName && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-teal-50 border border-teal-150 text-teal-800 shadow-xs">
                        سپلائر: {product.supplierName}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    لاگت: {formatCurrency(product.costPrice || 0)} • فروخت: {formatCurrency(product.sellingPrice || 0)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuickStockProduct(product);
                    setShowQuickStockModal(true);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                  title="اس پروڈکٹ میں پرانا یا نیا اسٹاک شامل کریں"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                  + اسٹاک ایڈ کریں
                </button>
                <div className="text-right">
                <p className={cn(
                    'font-bold',
                    (product.stock || 0) <= (product.lowStockThreshold || 0) ? 'text-red-600' : 'text-gray-900'
                  )}>
                    {(product.stock || 0)} اسٹاک میں ہے
                  </p>
                  {(product.stock || 0) <= (product.lowStockThreshold || 0) && (
                    <p className="text-xs text-red-500 font-medium font-bold">کم اسٹاک الرٹ!</p>
                  )}
                </div>
                <Button variant="ghost" className="text-gray-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); setProductToDelete(product.id); }}>
                  <Trash2 className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-bold">کوئی پروڈکٹ نہیں ملی</p>
          </div>
        )}
      </div>

      <div className="mt-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            اسٹاک لاگ اندراجات (Stock Additions History)
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStockLogSortAsc(!stockLogSortAsc)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
              title="ترتیب تبدیل کریں"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600" />
              <span>ترتیب: {stockLogSortAsc ? 'پہلے والا پہلے (Oldest First)' : 'نیا والا پہلے (Newest First)'}</span>
            </button>
          </div>
        </div>

        <Card className="overflow-hidden">
          {/* Mobile View */}
          <div className="md:hidden space-y-4 p-4 bg-white">
            {filteredLogs.map((log: any, index: number) => (
              <div key={log.id} className="p-4 border border-gray-100 rounded-xl bg-gray-50 flex flex-col gap-3">
                <div className="flex justify-between items-start border-b border-gray-200 pb-2">
                  <div className="flex items-start gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <div>
                      <h4 className="font-bold text-gray-900">{log.productName}</h4>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">{format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm')}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setEditingStockLog(log)}
                      className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                      title="اسٹاک لاگ ایڈٹ کریں"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setStockLogToDelete(log)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="اسٹاک اضافہ ختم کریں"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">تعداد:</span>
                  <span className="font-bold text-gray-900">{log.quantity}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">وجہ:</span>
                  <span className="text-gray-600 italic">{log.reason || 'سٹاک اضافہ'}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">فی یونٹ لاگت:</span>
                  <span className="text-gray-600">{formatCurrency(log.costPrice)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">کل رقم:</span>
                  <span className="font-bold text-indigo-600">{formatCurrency(log.totalCost)}</span>
                </div>
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <p className="text-center text-gray-500 py-4 text-sm font-bold">کوئی اسٹاک شامل نہیں کیا گیا</p>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center w-12">#</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">تاریخ</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">پروڈکٹ</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">وجہ</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">تعداد</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">لاگت</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">کل رقم</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">عمل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLogs.map((log: any, index: number) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 text-xs text-gray-400 font-bold text-center">{index + 1}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900 text-right">{log.productName}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 italic text-right">{log.reason || 'سٹاک اضافہ'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right font-bold">{log.quantity}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatCurrency(log.costPrice)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-indigo-600 text-right">{formatCurrency(log.totalCost)}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => setEditingStockLog(log)}
                          className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                          title="اسٹاک لاگ ایڈٹ کریں"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setStockLogToDelete(log)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="اسٹاک اضافہ ختم کریں"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400 italic font-bold">اس منتخب کردہ دورانیہ میں کوئی اسٹاک اندراج موجود نہیں۔</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <AnimatePresence>
        {productToDelete && (
          <ConfirmationModal
            title="Delete Product"
            message="Are you sure you want to delete this product? This will not affect existing orders."
            onConfirm={() => handleDelete(productToDelete)}
            onCancel={() => setProductToDelete(null)}
            confirmText="Delete"
            variant="danger"
          />
        )}
        {stockLogToDelete && (
          <ConfirmationModal
            title="Delete Stock Addition"
            message={`Are you sure you want to delete this stock addition of ${stockLogToDelete.quantity} ${stockLogToDelete.productName}? This will decrease the current stock of the product.`}
            onConfirm={() => handleDeleteStockLog(stockLogToDelete)}
            onCancel={() => setStockLogToDelete(null)}
            confirmText="Delete & Revert Stock"
            variant="danger"
          />
        )}
      </AnimatePresence>

      {editingStockLog && (
        <EditStockLogModal
          log={editingStockLog}
          products={products}
          orders={orders}
          onClose={() => setEditingStockLog(null)}
        />
      )}

      {showQuickStockModal && (
        <QuickAddStockModal
          products={products}
          initialProduct={quickStockProduct}
          onClose={() => {
            setShowQuickStockModal(false);
            setQuickStockProduct(null);
          }}
        />
      )}

      {showBulkStockModal && (
        <BulkStockImportModal
          products={products}
          onClose={() => setShowBulkStockModal(false)}
        />
      )}
    </motion.div>
  );
}

function SettingsView({ 
  settings,
  user,
  role,
  onLogout,
  onSwitchAccount,
  onRecordResult,
  onOpenInspector,
  whatsappLogsCount = 0
}: { 
  settings: Settings | null;
  user?: User | null;
  role?: string | null;
  onLogout?: () => void;
  onSwitchAccount?: () => void;
  onRecordResult?: (result: MetaSendResult) => void;
  onOpenInspector?: () => void;
  whatsappLogsCount?: number;
}) {
  const [formData, setFormData] = useState<Settings>(settings || {
    senderName: '',
    senderPhone: '',
    senderAddress: '',
    senderCity: '',
    senderCNIC: '',
    whatsappProvider: 'meta',
    metaPhoneNumberId: '',
    metaAccessToken: '',
    metaWabaId: '',
    ultraMsgInstanceId: '',
    ultraMsgToken: '',
    smsGatewayUrl: ''
  });

  const [showSuccess, setShowSuccess] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTestMsg, setSendingTestMsg] = useState(false);

  const isAdminUser = user?.email === 'noorullah03474763055@gmail.com' || user?.email === 'noorullah111111111@gmail.com' || role === 'admin';

  const handleSave = async () => {
    try {
      const currentUserId = auth.currentUser?.uid;
      const settingsDocId = currentUserId || 'global';
      await setDoc(doc(db, 'settings', settingsDocId), {
        ...formData,
        userId: currentUserId
      }, { merge: true });
      setShowSuccess(true);
      toast.success('سیٹنگز محفوظ ہو گئی ہیں!');
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings');
    }
  };

  const handleTestMetaConnection = async () => {
    if (!formData.metaPhoneNumberId || !formData.metaAccessToken) {
      toast.error('براہ کرم Phone Number ID اور Permanent Access Token دونوں درج کریں۔');
      return;
    }

    setTestingMeta(true);
    try {
      const checkRes = await checkMetaAccountInfo({
        phoneNumberId: formData.metaPhoneNumberId,
        accessToken: formData.metaAccessToken,
      });

      if (checkRes.success) {
        toast.success(checkRes.urduAdvice || '✅ Meta Cloud API رابطہ کامیاب!');
        alert(`${checkRes.urduAdvice}\n\nاکاؤنٹ کی تفصیلات:\nVerified Name: ${checkRes.data?.verified_name || 'N/A'}\nPhone Number: ${checkRes.data?.display_phone_number || 'N/A'}\nQuality Rating: ${checkRes.data?.quality_rating || 'GREEN'}`);
      } else {
        toast.error(checkRes.urduAdvice || `❌ Meta API Error: ${checkRes.errorMessage}`);
        alert(`${checkRes.urduAdvice}\n\nتکنیکی تفصیلات: ${checkRes.errorMessage}`);
      }
    } catch (err: any) {
      toast.error(`ارسال ایرر: ${err?.message || 'نیٹ ورک کنکشن چیک کریں'}`);
    } finally {
      setTestingMeta(false);
    }
  };

  const handleSendTestMetaMsg = async () => {
    if (!formData.metaPhoneNumberId || !formData.metaAccessToken) {
      toast.error('براہ کرم Phone Number ID اور Access Token پہلے درج کریں۔');
      return;
    }

    const rawPhone = testPhone || formData.senderPhone;
    if (!rawPhone) {
      toast.error('براہ کرم ٹیسٹ میسج کے لیے فون نمبر درج کریں۔');
      return;
    }

    setSendingTestMsg(true);
    try {
      const result = await sendMetaWhatsAppMessage({
        phoneNumberId: formData.metaPhoneNumberId,
        accessToken: formData.metaAccessToken,
        recipientPhone: rawPhone,
        messageText: 'سلام! یہ پاکستان پوسٹ ڈیش بورڈ سے Meta WhatsApp Cloud API کا ٹیسٹ میسج ہے۔ ✅',
        messageType: formData.metaMessageType || 'auto',
        templateName: formData.metaTemplateName || 'hello_world',
        templateLanguage: formData.metaTemplateLanguage || 'en_US',
      });

      if (onRecordResult) onRecordResult(result);
      if (onOpenInspector) onOpenInspector();

      if (result.success) {
        toast.success(`🎉 ٹیسٹ میسج کامیابی سے بھیج دیا گیا! Message ID: ${result.messageId}`);
      } else {
        toast.error(`❌ ٹیسٹ میسج ناکام: ${result.errorMessage}`, { duration: 6000 });
      }
    } catch (err: any) {
      toast.error(`ایرر: ${err?.message || 'بھیجنا ناکام ہوا'}`);
    } finally {
      setSendingTestMsg(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-2xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">سیٹنگز (Settings)</h2>
        <AnimatePresence>
          {showSuccess && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              سیٹنگز محفوظ ہوگئی مٹھائی بانٹیں!
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* USER GOOGLE ACCOUNT & SWITCH SECTION */}
      {user && (
        <Card className="p-6 space-y-4 text-right" dir="rtl">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">لاگ ان گوگل اکاؤنٹ (Google Account)</h3>
                <p className="text-xs text-gray-500">اکاؤنٹ کی تفصیلات اور سوئچنگ کے اختیارات</p>
              </div>
            </div>
            {isAdminUser ? (
              <span className="text-[11px] bg-indigo-100 text-indigo-800 font-extrabold px-2.5 py-1 rounded-full border border-indigo-200">
                ⚡ ایڈمن اکاؤنٹ (Admin)
              </span>
            ) : (
              <span className="text-[11px] bg-emerald-100 text-emerald-800 font-extrabold px-2.5 py-1 rounded-full border border-emerald-200">
                ✓ فعال صارف (Active)
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
            <img 
              src={user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'} 
              className="w-14 h-14 rounded-full border-2 border-indigo-200 shadow-xs object-cover shrink-0" 
              alt="User" 
            />
            <div className="flex-1 text-center sm:text-right space-y-0.5">
              <h4 className="font-bold text-base text-gray-900">{user.displayName || 'نامعلوم صارف'}</h4>
              <p className="text-xs text-gray-600 font-mono" dir="ltr">{user.email}</p>
              <p className="text-[11px] text-gray-500 pt-0.5">
                اسٹیٹس: <span className="text-emerald-700 font-bold">منظور شدہ (Active & Approved)</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {onSwitchAccount && (
              <button
                type="button"
                onClick={onSwitchAccount}
                className="w-full py-2.5 px-3 rounded-xl font-bold text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                title="دوسرا گوگل اکاؤنٹ منتخب کریں"
              >
                <RefreshCw className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>دوسرا اکاؤنٹ تبدیل کریں (Switch Account)</span>
              </button>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full py-2.5 px-3 rounded-xl font-bold text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200/80 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                title="سسٹم سے لاگ آؤٹ کریں"
              >
                <LogOut className="w-4 h-4 text-red-600 shrink-0" />
                <span>لاگ آؤٹ کریں (Log Out)</span>
              </button>
            )}
          </div>
        </Card>
      )}

      <Card className="p-6 space-y-4 text-right" dir="rtl">
        <h3 className="text-lg font-bold mb-4">آپ کی تفصیل (Sender Information)</h3>
        <div className="grid gap-4">
          <div>
            <Label>کاروبار کا نام</Label>
            <Input value={formData.senderName} onChange={(e: any) => setFormData({ ...formData, senderName: e.target.value })} />
          </div>
          <div>
            <Label>فون نمبر</Label>
            <Input value={formData.senderPhone} onChange={(e: any) => setFormData({ ...formData, senderPhone: e.target.value })} />
          </div>
          <div>
            <Label>مکمل پتہ</Label>
            <Input value={formData.senderAddress} onChange={(e: any) => setFormData({ ...formData, senderAddress: e.target.value })} />
          </div>
          <div>
            <Label>شہر</Label>
            <Input value={formData.senderCity} onChange={(e: any) => setFormData({ ...formData, senderCity: e.target.value })} />
          </div>
          <div>
            <Label>شناختی کارڈ نمبر (CNIC)</Label>
            <Input value={formData.senderCNIC || ''} onChange={(e: any) => setFormData({ ...formData, senderCNIC: e.target.value })} placeholder="مثلاً 4210112345671" />
          </div>
        </div>
      </Card>

      {/* WHATSAPP AUTOMATION INTEGRATION CARD */}
      <Card className="p-6 space-y-5 text-right" dir="rtl">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              💬
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">واٹس ایپ آٹومیشن (WhatsApp Integration)</h3>
              <p className="text-xs text-gray-500">اپنا پسندیدہ واٹس ایپ پرووائیڈر منتخب کریں</p>
            </div>
          </div>
        </div>

        {/* PROVIDER SELECTION SWITCH */}
        <div className="grid grid-cols-3 gap-2 bg-gray-100 p-1.5 rounded-xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, whatsappProvider: 'meta' })}
            className={cn(
              "py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5",
              (formData.whatsappProvider === 'meta' || (!formData.whatsappProvider && formData.metaPhoneNumberId))
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            )}
          >
            🚀 Meta Cloud API
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, whatsappProvider: 'ultramsg' })}
            className={cn(
              "py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5",
              formData.whatsappProvider === 'ultramsg'
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            )}
          >
            ⚡ UltraMsg API
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, whatsappProvider: 'manual' })}
            className={cn(
              "py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5",
              formData.whatsappProvider === 'manual'
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            )}
          >
            🌐 دستی لنکس (Manual)
          </button>
        </div>

        {/* META CLOUD API CONFIGURATION */}
        {(formData.whatsappProvider === 'meta' || (!formData.whatsappProvider && !formData.ultraMsgInstanceId)) && (
          <div className="space-y-4 bg-emerald-50/60 p-4 rounded-xl border border-emerald-200">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-emerald-900">Meta WhatsApp Cloud API (سرکاری میٹا کریڈینشلز)</span>
              <a 
                href="https://developers.facebook.com/apps/" 
                target="_blank" 
                rel="noreferrer"
                className="text-[11px] text-indigo-600 hover:underline font-semibold"
              >
                Meta Developer Console ↗
              </a>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Meta Developers Dashboard سے اپنا <strong>Phone Number ID</strong> اور <strong>Permanent System User Access Token</strong> کاپی کر کے نیچے درج کریں۔
            </p>

            <div className="grid gap-3 text-left" dir="ltr">
              <div>
                <Label className="text-right block text-xs font-bold text-gray-700" dir="rtl">
                  Phone Number ID (فون نمبر آئی ڈی)
                </Label>
                <Input 
                  placeholder="e.g. 109283746510293" 
                  value={formData.metaPhoneNumberId || ''} 
                  onChange={(e: any) => setFormData({ ...formData, metaPhoneNumberId: e.target.value })}
                  className="font-mono text-xs mt-1"
                />
              </div>

              <div>
                <Label className="text-right block text-xs font-bold text-gray-700" dir="rtl">
                  Permanent Access Token (سسٹم یوزر ٹوکن)
                </Label>
                <Input 
                  type="password"
                  placeholder="EAAG..." 
                  value={formData.metaAccessToken || ''} 
                  onChange={(e: any) => setFormData({ ...formData, metaAccessToken: e.target.value })}
                  className="font-mono text-xs mt-1"
                />
              </div>

              <div>
                <Label className="text-right block text-xs font-bold text-gray-700" dir="rtl">
                  WhatsApp Business Account ID (WABA ID - آپشنل)
                </Label>
                <Input 
                  placeholder="e.g. 10029384756102" 
                  value={formData.metaWabaId || ''} 
                  onChange={(e: any) => setFormData({ ...formData, metaWabaId: e.target.value })}
                  className="font-mono text-xs mt-1"
                />
              </div>

              {/* MESSAGE TYPE & TEMPLATE OPTIONS */}
              <div className="pt-2 border-t border-emerald-200/80 space-y-3" dir="rtl">
                <Label className="text-xs font-bold text-emerald-950 block">میسج بھیجنے کا طریقہ (Message Delivery Mode)</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, metaMessageType: 'auto' })}
                    className={cn(
                      "p-2 rounded-lg border text-right transition-all",
                      (!formData.metaMessageType || formData.metaMessageType === 'auto')
                        ? "bg-emerald-600 text-white font-bold border-emerald-600 shadow-sm"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    ⚡ آٹو (تجویز کردہ)
                    <span className="block text-[10px] font-normal opacity-90">24h ونڈو نہ ہونے پر آٹو ٹیمپلیٹ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, metaMessageType: 'template' })}
                    className={cn(
                      "p-2 rounded-lg border text-right transition-all",
                      formData.metaMessageType === 'template'
                        ? "bg-emerald-600 text-white font-bold border-emerald-600 shadow-sm"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    📋 ٹیمپلیٹ موڈ
                    <span className="block text-[10px] font-normal opacity-90">24 گھنٹے کی کوئی پابندی نہیں</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, metaMessageType: 'text' })}
                    className={cn(
                      "p-2 rounded-lg border text-right transition-all",
                      formData.metaMessageType === 'text'
                        ? "bg-emerald-600 text-white font-bold border-emerald-600 shadow-sm"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    💬 فری متن میسج
                    <span className="block text-[10px] font-normal opacity-90">صرف 24 گھنٹے کے اندر فعال</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-left" dir="ltr">
                  <div>
                    <Label className="text-right block text-[11px] font-semibold text-gray-700" dir="rtl">
                      ٹیمپلیٹ کا نام (Template Name)
                    </Label>
                    <Input 
                      placeholder="hello_world" 
                      value={formData.metaTemplateName || 'hello_world'} 
                      onChange={(e: any) => setFormData({ ...formData, metaTemplateName: e.target.value })}
                      className="font-mono text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-right block text-[11px] font-semibold text-gray-700" dir="rtl">
                      زبان کا کوڈ (Language Code)
                    </Label>
                    <Input 
                      placeholder="en_US" 
                      value={formData.metaTemplateLanguage || 'en_US'} 
                      onChange={(e: any) => setFormData({ ...formData, metaTemplateLanguage: e.target.value })}
                      className="font-mono text-xs mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* GUIDE & TROUBLESHOOTING BOX */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1.5 text-amber-900" dir="rtl">
              <p className="font-bold flex items-center gap-1.5 text-amber-950">
                <span>💡 Meta Cloud API کے اہم نکات اور حل:</span>
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed text-amber-900/90">
                <li><strong>24 گھنٹے کی پالیسی (24h Window):</strong> اگر گاہک نے پہلے آپ کو واٹس ایپ پر میسج نہ کیا ہو تو میٹا صرف <i>Template</i> (مثلاً hello_world) بھیجنے دیتا ہے۔ 'آٹو' یا 'ٹیمپلیٹ موڈ' منتخب رکھیں۔</li>
                <li><strong>تاریک/عارضی ٹوکن:</strong> اگر میٹا کا ٹوکن ختم ہو جائے تو Meta Dashboard سے <strong>Permanent System User Token</strong> حاصل کریں۔</li>
                <li><strong>ٹیسٹ نمبرز (Test Numbers):</strong> میٹا فری ٹیسٹ اکاؤنٹ میں صرف ان فون نمبرز پر میسج جاتا ہے جو آپ کے Developer Dashboard کے 'To Phone Number' میں ایڈ (Add) ہوں۔</li>
              </ul>
            </div>

            {/* TEST META CLOUD API BUTTONS */}
            <div className="pt-2 border-t border-emerald-200 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={handleTestMetaConnection}
                  disabled={testingMeta}
                  variant="outline"
                  className="bg-white border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs font-bold h-9"
                >
                  {testingMeta ? 'چیک ہو رہا ہے...' : '🔍 Meta API کنکشن چیک کریں'}
                </Button>
                <Button
                  type="button"
                  onClick={onOpenInspector}
                  variant="outline"
                  className="bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 text-xs font-bold h-9"
                >
                  💻 آفیشل میٹا لائیو لاگز و انسپیکٹر دیکھئے ({whatsappLogsCount})
                </Button>
              </div>

              <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-emerald-200">
                <Input
                  dir="ltr"
                  placeholder="ٹیسٹ فون نمبر (مثلاً 03001234567)"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="text-xs h-8 font-mono"
                />
                <Button
                  type="button"
                  onClick={handleSendTestMetaMsg}
                  disabled={sendingTestMsg}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-nowrap h-8 px-3"
                >
                  {sendingTestMsg ? 'بھیجا جا رہا ہے...' : '📩 ٹیسٹ میسج بھیجیں'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ULTRAMSG CONFIGURATION */}
        {formData.whatsappProvider === 'ultramsg' && (
          <div className="space-y-4 bg-indigo-50/60 p-4 rounded-xl border border-indigo-200">
            <span className="font-bold text-sm text-indigo-900">UltraMsg API کریڈینشلز</span>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs font-bold">UltraMsg Instance ID</Label>
                <Input 
                  placeholder="e.g. instance12345" 
                  value={formData.ultraMsgInstanceId || ''} 
                  onChange={(e: any) => setFormData({ ...formData, ultraMsgInstanceId: e.target.value })} 
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-bold">UltraMsg Token</Label>
                <Input 
                  type="password"
                  placeholder="Your UltraMsg Token" 
                  value={formData.ultraMsgToken || ''} 
                  onChange={(e: any) => setFormData({ ...formData, ultraMsgToken: e.target.value })} 
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>
        )}

        {/* MANUAL LINKS CONFIGURATION */}
        {formData.whatsappProvider === 'manual' && (
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-600">
            آپ نے دستی (Manual) اوپشن منتخب کیا ہے۔ میسج پر کلک کرنے پر واٹس ایپ ویب یا واٹس ایپ ایپ کھل جائے گی۔
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          SMS Gateway API (برانڈڈ/سادہ SMS)
        </h3>
        <p className="text-xs text-gray-500 mb-2">
          اگر آپ کسی SMS گیٹ وے API (جیسے Jazz, Telenor, Branded SMS) کے ذریعے براہ راست SMS بھیجنا چاہتے ہیں تو اپنا API URL درج کریں۔
          یو آر ایل میں <code className="bg-gray-100 px-1 font-mono text-indigo-600">{'{phone}'}</code> اور <code className="bg-gray-100 px-1 font-mono text-indigo-600">{'{message}'}</code> کے ٹیگز شامل کریں۔
        </p>
        <div>
          <Label>SMS Gateway API URL</Label>
          <Input 
            placeholder="مثلاً https://api.sms-provider.com/send?key=123&to={phone}&msg={message}" 
            value={formData.smsGatewayUrl || ''} 
            onChange={(e: any) => setFormData({ ...formData, smsGatewayUrl: e.target.value })} 
          />
        </div>
      </Card>

      <Card className="p-6">
        <Button onClick={handleSave} className="w-full font-bold bg-indigo-600 hover:bg-indigo-700 text-white">
          سیٹنگز محفوظ کریں
        </Button>
      </Card>
    </motion.div>
  );
}

function PartnerReportTemplate({ orders, partnerName, periodName }: any) {
  const totalOrders = orders.length;
  const returnedOrders = orders.filter((o: any) => o.status === 'Returned').length;
  const deliveredOrders = orders.filter((o: any) => o.status === 'Delivered').length;
  const otherOrders = totalOrders - returnedOrders - deliveredOrders;

  const totalRevenue = orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
  const totalPartnerProfit = orders.reduce((sum: number, o: any) => sum + (o.partnerProfitAmount || 0), 0);
  
  const receivedFromCustomer = orders.filter((o: any) => o.paymentReceived);
  const pendingFromCustomer = orders.filter((o: any) => !o.paymentReceived);
  
  const receivedProfit = receivedFromCustomer.reduce((sum: number, o: any) => sum + (o.partnerProfitAmount || 0), 0);
  const pendingProfit = pendingFromCustomer.reduce((sum: number, o: any) => sum + (o.partnerProfitAmount || 0), 0);
  
  const paidProfit = orders.filter((o: any) => o.partnerPaid).reduce((sum: number, o: any) => sum + (o.partnerProfitAmount || 0), 0);
  const readyForPayout = receivedProfit - paidProfit;

  return (
    <div style={{ padding: '40px', backgroundColor: '#ffffff', width: '800px', color: '#111827', fontFamily: '"Inter", "Noto Sans Arabic", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '4px solid #4f46e5', paddingBottom: '24px', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '48px', fontWeight: '900', color: '#4f46e5', margin: '0 0 8px 0' }}>ShipFlow</h1>
          <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#6b7280', margin: 0 }}>Partner Settlement Report</p>
          <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>پارٹنر سیٹلمنٹ رپورٹ</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', margin: 0 }}>Partner Name</p>
          <p style={{ fontSize: '30px', fontWeight: '900', margin: 0 }}>{partnerName}</p>
          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', margin: 0 }}>Period: {periodName}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <div style={{ backgroundColor: '#f3f4f6', padding: '16px', borderRadius: '16px' }}>
          <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#6b7280', marginBottom: '4px', margin: 0 }}>Total Orders / کل آرڈرز</p>
          <p style={{ fontSize: '20px', fontWeight: '900', color: '#111827', margin: 0 }}>{totalOrders}</p>
        </div>
        <div style={{ backgroundColor: '#ecfdf5', padding: '16px', borderRadius: '16px' }}>
          <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#059669', marginBottom: '4px', margin: 0 }}>Delivered / ڈیلیورڈ</p>
          <p style={{ fontSize: '20px', fontWeight: '900', color: '#064e3b', margin: 0 }}>{deliveredOrders}</p>
        </div>
        <div style={{ backgroundColor: '#fef2f2', padding: '16px', borderRadius: '16px' }}>
          <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#dc2626', marginBottom: '4px', margin: 0 }}>Returned / واپس آئے</p>
          <p style={{ fontSize: '20px', fontWeight: '900', color: '#7f1d1d', margin: 0 }}>{returnedOrders}</p>
        </div>
        <div style={{ backgroundColor: '#fffbeb', padding: '16px', borderRadius: '16px' }}>
          <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#d97706', marginBottom: '4px', margin: 0 }}>Other / دیگر</p>
          <p style={{ fontSize: '20px', fontWeight: '900', color: '#78350f', margin: 0 }}>{otherOrders}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <div style={{ backgroundColor: '#eef2ff', padding: '20px', borderRadius: '20px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#4f46e5', marginBottom: '4px', margin: 0 }}>Total Potential Share / کل ممکنہ حصہ</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#1e1b4b', margin: 0 }}>{formatCurrency(totalPartnerProfit)}</p>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '20px', borderRadius: '20px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#c2410c', marginBottom: '4px', margin: 0 }}>Pending Cust. Payment / کسٹمر کی بقایا ادائیگی</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#7c2d12', margin: 0 }}>{formatCurrency(pendingProfit)}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '40px' }}>
        <div style={{ backgroundColor: '#ecfdf5', padding: '20px', borderRadius: '20px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#059669', marginBottom: '4px', margin: 0 }}>Ready for Payout / وصول شدہ اور واجب الادا</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#064e3b', margin: 0 }}>{formatCurrency(readyForPayout)}</p>
        </div>
        <div style={{ backgroundColor: '#f0f9ff', padding: '20px', borderRadius: '20px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#0284c7', marginBottom: '4px', margin: 0 }}>Already Paid / ادا شدہ</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#0c4a6e', margin: 0 }}>{formatCurrency(paidProfit)}</p>
        </div>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', borderBottom: '2px solid #f3f4f6', paddingBottom: '10px' }}>Order Details / آرڈر کی تفصیلات</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>
              <th style={{ padding: '12px 0' }}>Date / تاریخ</th>
              <th style={{ padding: '12px 0' }}>Customer / کسٹمر</th>
              <th style={{ padding: '12px 0' }}>Status / حالت</th>
              <th style={{ padding: '12px 0' }}>Payment / ادائیگی</th>
              <th style={{ padding: '12px 0' }}>Share / حصہ</th>
              <th style={{ padding: '12px 0' }}>Payout / ادائیگی</th>
            </tr>
          </thead>
          <tbody>
            {orders.length > 0 ? orders.map((o: any) => (
              <tr key={o.id} style={{ fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px 0', color: '#6b7280' }}>{format(new Date(o.createdAt), 'dd MMM')}</td>
                <td style={{ padding: '12px 0' }}>
                  <div style={{ fontWeight: 'bold' }}>{o.customerName}</div>
                  <div style={{ fontSize: '10px', color: '#9ca3af' }}>{o.trackingNumber}</div>
                </td>
                <td style={{ padding: '12px 0' }}>
                  <span style={{ 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    fontSize: '10px',
                    backgroundColor: o.status === 'Delivered' ? '#dcfce7' : o.status === 'Returned' ? '#fee2e2' : '#fef9c3',
                    color: o.status === 'Delivered' ? '#166534' : o.status === 'Returned' ? '#991b1b' : '#854d0e'
                  }}>
                    {o.status}
                  </span>
                </td>
                <td style={{ padding: '12px 0', color: o.paymentReceived ? '#059669' : '#d97706', fontWeight: 'bold' }}>
                  {o.paymentReceived ? 'Received' : 'Pending'}
                </td>
                <td style={{ padding: '12px 0', fontWeight: 'bold' }}>{formatCurrency(o.partnerProfitAmount || 0)}</td>
                <td style={{ padding: '12px 0', color: o.partnerPaid ? '#2563eb' : '#9ca3af', fontWeight: 'bold' }}>
                  {o.partnerPaid ? (
                    <div>
                      <div>Paid</div>
                      {o.partnerPaidAt && <div style={{ fontSize: '9px', fontWeight: 'normal' }}>{format(new Date(o.partnerPaidAt), 'dd MMM')}</div>}
                    </div>
                  ) : 'Unpaid'}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} style={{ padding: '40px 0', textAlign: 'center', color: '#9ca3af' }}>No orders found for this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '60px', borderTop: '1px solid #f3f4f6', paddingTop: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
        <p>This is an automated settlement report generated by ShipFlow Manager.</p>
      </div>
    </div>
  );
}

function StockReportTemplate({ stockLogs, periodName, totalCost, totalQty, supplierName, products }: any) {
  const calculatedTotalQty = totalQty !== undefined ? totalQty : stockLogs.reduce((sum: number, l: any) => sum + (l.quantity || 0), 0);
  const calculatedTotalCost = totalCost !== undefined ? totalCost : stockLogs.reduce((sum: number, l: any) => sum + (l.totalCost || 0), 0);

  return (
    <div style={{ padding: '35px 40px', backgroundColor: '#ffffff', width: '850px', color: '#0f172a', fontFamily: '"Noto Sans Arabic", "Inter", sans-serif', boxSizing: 'border-box' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #059669', paddingBottom: '20px', marginBottom: '25px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <div style={{ width: '32px', height: '32px', backgroundColor: '#059669', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontWeight: 'bold', fontSize: '18px' }}>
              📦
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: '900', color: '#064e3b', margin: 0, letterSpacing: '-0.02em' }}>
              اسٹاک اندراج و خریداری رپورٹ (Stock Report)
            </h1>
          </div>
          <p style={{ fontSize: '13px', color: '#059669', fontWeight: 'bold', margin: '4px 0 0 0' }}>
            دورانیہ (Period): <span style={{ color: '#0f172a' }}>{periodName}</span>
            {supplierName && (
              <span style={{ color: '#0284c7', marginRight: '16px', marginLeft: '16px' }}>
                • مال سپلائر: <strong>{supplierName === 'Direct' ? 'براہِ راست (بغیر سپلائر)' : supplierName}</strong>
              </span>
            )}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 2px 0' }}>رپورٹ تیار کردہ تاریخ (Generated on)</p>
          <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{format(new Date(), 'dd MMMM yyyy, hh:mm a')}</p>
          <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold' }}>
            ✓ تاریخ وار ترتیب شدہ (Chronological Order)
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '28px' }}>
        <div style={{ backgroundColor: '#f8fafc', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', margin: '0 0 4px 0' }}>کل اندراجات (Total Entries)</p>
          <p style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', margin: 0 }}>{stockLogs.length}</p>
        </div>
        <div style={{ backgroundColor: '#f0fdf4', padding: '16px 20px', borderRadius: '16px', border: '1px solid #bbf7d0' }}>
          <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#16a34a', margin: '0 0 4px 0' }}>کل تعداد / آئٹمز (Total Qty Added)</p>
          <p style={{ fontSize: '26px', fontWeight: '900', color: '#15803d', margin: 0 }}>{calculatedTotalQty} <span style={{ fontSize: '14px', fontWeight: 'normal' }}>عدد</span></p>
        </div>
        <div style={{ backgroundColor: '#ecfdf5', padding: '16px 20px', borderRadius: '16px', border: '1.5px solid #059669' }}>
          <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#047857', margin: '0 0 4px 0' }}>کل لاگتِ خرید (Total Stock Purchase Value)</p>
          <p style={{ fontSize: '26px', fontWeight: '900', color: '#065f46', margin: 0 }}>{formatCurrency(calculatedTotalCost)}</p>
        </div>
      </div>

      {/* Detailed Table */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
            اسٹاک لاگ اندراجات کی تفصیلی لسٹ (Stock Addition Ledger)
          </h2>
          <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
            (سب سے پہلے درج شدہ مال نمبر 1 پر، بعد کا مال اس کے بعد ترتیب سے)
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1', color: '#334155', fontWeight: 'bold' }}>
              <th style={{ padding: '10px 8px', textAlign: 'center', width: '35px', borderRight: '1px solid #e2e8f0' }}>#</th>
              <th style={{ padding: '10px 10px', textAlign: 'center', width: '95px', borderRight: '1px solid #e2e8f0' }}>تاریخ (Date)</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', borderRight: '1px solid #e2e8f0' }}>پروڈکٹ کا نام (Product)</th>
              <th style={{ padding: '10px 10px', textAlign: 'left', width: '110px', borderRight: '1px solid #e2e8f0' }}>سپلائر (Supplier)</th>
              <th style={{ padding: '10px 10px', textAlign: 'left', width: '130px', borderRight: '1px solid #e2e8f0' }}>وجہ / کیٹگری (Reason)</th>
              <th style={{ padding: '10px 8px', textAlign: 'center', width: '55px', borderRight: '1px solid #e2e8f0' }}>تعداد</th>
              <th style={{ padding: '10px 10px', textAlign: 'right', width: '85px', borderRight: '1px solid #e2e8f0' }}>قیمتِ خرید</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', width: '105px' }}>کل رقم (Total)</th>
            </tr>
          </thead>
          <tbody>
            {stockLogs.length > 0 ? stockLogs.map((log: any, index: number) => {
              const matchedProduct = products?.find((p: any) => p.id === log.productId);
              const supName = log.supplierName || matchedProduct?.supplierName || 'Direct / ذاتی';
              const isEven = index % 2 === 0;

              return (
                <tr key={log.id || index} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: isEven ? '#ffffff' : '#f8fafc' }}>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 'bold', color: '#64748b', borderRight: '1px solid #f1f5f9' }}>
                    {index + 1}
                  </td>
                  <td style={{ padding: '10px 10px', textAlign: 'center', color: '#334155', fontWeight: '500', whiteSpace: 'nowrap', borderRight: '1px solid #f1f5f9' }}>
                    {format(new Date(log.createdAt), 'dd-MM-yyyy')}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 'bold', color: '#0f172a', borderRight: '1px solid #f1f5f9' }}>
                    {log.productName}
                  </td>
                  <td style={{ padding: '10px 10px', color: '#475569', fontSize: '11px', borderRight: '1px solid #f1f5f9' }}>
                    {supName}
                  </td>
                  <td style={{ padding: '10px 10px', color: '#475569', fontSize: '11px', borderRight: '1px solid #f1f5f9' }}>
                    <span style={{ 
                      display: 'inline-block', 
                      padding: '2px 6px', 
                      borderRadius: '4px', 
                      backgroundColor: log.reason?.includes('پچھلے') ? '#fef3c7' : '#f1f5f9',
                      color: log.reason?.includes('پچھلے') ? '#92400e' : '#334155',
                      fontWeight: log.reason?.includes('پچھلے') ? 'bold' : 'normal'
                    }}>
                      {log.reason || 'اسٹاک اضافہ'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 'bold', color: '#047857', borderRight: '1px solid #f1f5f9' }}>
                    {log.quantity}
                  </td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', color: '#475569', borderRight: '1px solid #f1f5f9' }}>
                    {formatCurrency(log.costPrice)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '900', color: '#065f46' }}>
                    {formatCurrency(log.totalCost)}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontWeight: 'bold' }}>
                  اس منتخب شدہ دورانیہ میں اسٹاک کا کوئی اندراج موجود نہیں ہے۔
                </td>
              </tr>
            )}
          </tbody>
          {stockLogs.length > 0 && (
            <tfoot>
              <tr style={{ backgroundColor: '#ecfdf5', borderTop: '2.5px solid #059669', borderBottom: '2.5px solid #059669', fontWeight: 'bold' }}>
                <td colSpan={5} style={{ padding: '12px 14px', textAlign: 'right', fontSize: '13px', color: '#064e3b' }}>
                  <strong>کل میزان (Grand Total):</strong>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontSize: '13px', color: '#064e3b' }}>
                  <strong>{calculatedTotalQty}</strong>
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontSize: '11px', color: '#064e3b' }}>
                  -
                </td>
                <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: '15px', color: '#064e3b', fontWeight: '900' }}>
                  {formatCurrency(calculatedTotalCost)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Verification & Signature Footer */}
      <div style={{ marginTop: '40px', borderTop: '1px dashed #cbd5e1', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '11px', color: '#64748b' }}>
        <div>
          <p style={{ margin: '0 0 3px 0', fontWeight: 'bold', color: '#334155' }}>یہ کمپیوٹرائزڈ خودکار تصدیق شدہ رپورٹ ہے (Verified System Record)</p>
          <p style={{ margin: 0 }}>ShipFlow Inventory Management System</p>
        </div>
        <div style={{ textAlign: 'center', width: '180px' }}>
          <div style={{ borderBottom: '1px solid #475569', marginBottom: '5px', height: '30px' }}></div>
          <p style={{ margin: 0, fontWeight: 'bold', color: '#334155' }}>دستخط / ایڈمن تصدیق</p>
        </div>
      </div>
    </div>
  );
}

function ReportTemplate({ orders, periodName, totalRevenue, totalProfit, profitMargin, partnerStats, stockSummary }: any) {
  return (
    <div style={{ padding: '40px', backgroundColor: '#ffffff', width: '800px', color: '#111827', fontFamily: '"Inter", "Noto Sans Arabic", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '4px solid #4f46e5', paddingBottom: '24px', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '48px', fontWeight: '900', color: '#4f46e5', margin: '0 0 8px 0' }}>ShipFlow</h1>
          <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#6b7280', margin: 0 }}>کارکردگی رپورٹ (Performance Report)</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', margin: 0 }}>رپورٹ کا دورانیہ (Period)</p>
          <p style={{ fontSize: '30px', fontWeight: '900', margin: 0 }}>{periodName}</p>
          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', margin: 0 }}>تیار کردہ: {format(new Date(), 'dd MMM yyyy, HH:mm')}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '40px' }}>
        <div style={{ backgroundColor: '#eef2ff', padding: '24px', borderRadius: '24px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#4f46e5', marginBottom: '4px', margin: 0 }}>Total Revenue / کل آمدنی</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#1e1b4b', margin: 0 }}>{formatCurrency(totalRevenue)}</p>
        </div>
        <div style={{ backgroundColor: '#ecfdf5', padding: '24px', borderRadius: '24px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#059669', marginBottom: '4px', margin: 0 }}>Net Profit / خالص منافع</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#064e3b', margin: 0 }}>{formatCurrency(totalProfit)}</p>
        </div>
        <div style={{ backgroundColor: '#eff6ff', padding: '24px', borderRadius: '24px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#2563eb', marginBottom: '4px', margin: 0 }}>Profit Margin / شرح منافع</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#1e3a8a', margin: 0 }}>{profitMargin.toFixed(1)}%</p>
        </div>
        <div style={{ backgroundColor: '#f9fafb', padding: '24px', borderRadius: '24px' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#4b5563', marginBottom: '4px', margin: 0 }}>Total Orders / کل آرڈرز</p>
          <p style={{ fontSize: '24px', fontWeight: '900', color: '#111827', margin: 0 }}>{orders.length}</p>
        </div>
      </div>

      {stockSummary && stockSummary.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '8px', height: '32px', backgroundColor: '#f59e0b', borderRadius: '9999px' }}></div>
            Stock Summary / اسٹاک کی تفصیل
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', borderBottom: '2px solid #f3f4f6' }}>
                <th style={{ paddingBottom: '16px' }}>Product / پروڈکٹ</th>
                <th style={{ paddingBottom: '16px' }}>Sold / فروخت</th>
                <th style={{ paddingBottom: '16px' }}>Cost / لاگت</th>
                <th style={{ paddingBottom: '16px' }}>Revenue / آمدنی</th>
                <th style={{ paddingBottom: '16px' }}>Profit / منافع</th>
              </tr>
            </thead>
            <tbody>
              {stockSummary.map((s: any) => (
                <tr key={s.id} style={{ fontSize: '14px', borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '16px 0', fontWeight: 'bold' }}>{s.name}</td>
                  <td style={{ padding: '16px 0' }}>{s.quantity}</td>
                  <td style={{ padding: '16px 0', color: '#6b7280' }}>{formatCurrency(s.totalCost)}</td>
                  <td style={{ padding: '16px 0', fontWeight: 'bold' }}>{formatCurrency(s.totalAmount)}</td>
                  <td style={{ padding: '16px 0', fontWeight: 'bold', color: '#059669' }}>{formatCurrency(s.totalAmount - s.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '8px', height: '32px', backgroundColor: '#10b981', borderRadius: '9999px' }}></div>
          Partner Performance / پارٹنر کی کارکردگی
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', borderBottom: '2px solid #f3f4f6' }}>
              <th style={{ paddingBottom: '16px' }}>Partner / پارٹنر</th>
              <th style={{ paddingBottom: '16px' }}>Orders / آرڈرز</th>
              <th style={{ paddingBottom: '16px' }}>Total Profit / کل منافع</th>
              <th style={{ paddingBottom: '16px' }}>Paid / ادا شدہ</th>
              <th style={{ paddingBottom: '16px' }}>Pending / بقایا</th>
            </tr>
          </thead>
          <tbody>
            {partnerStats.map((s: any) => (
              <tr key={s.name} style={{ fontSize: '16px', borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ fontWeight: 'bold', padding: '20px 0' }}>{s.name}</td>
                <td style={{ padding: '20px 0' }}>{s.orderCount}</td>
                <td style={{ fontWeight: 'bold', color: '#4f46e5', padding: '20px 0' }}>{formatCurrency(s.totalProfit)}</td>
                <td style={{ fontWeight: '500', color: '#059669', padding: '20px 0' }}>{formatCurrency(s.paid || 0)}</td>
                <td style={{ fontWeight: '500', color: '#2563eb', padding: '20px 0' }}>{formatCurrency(s.partnerProfit - (s.paid || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '8px', height: '32px', backgroundColor: '#6366f1', borderRadius: '9999px' }}></div>
          آرڈرز کی مکمل تفصیل (Detailed Order List)
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: '#9ca3af', borderBottom: '2px solid #f3f4f6' }}>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>تاریخ</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>گاہک</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>شہر</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>پارٹنر</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>رقم</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>منافع</th>
              <th style={{ paddingBottom: '12px', textAlign: 'right' }}>اسٹیٹس</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: any) => (
              <tr key={o.id} style={{ fontSize: '11px', borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px 0', color: '#6b7280', textAlign: 'right' }}>{format(new Date(o.createdAt), 'dd MMM')}</td>
                <td style={{ padding: '12px 0', fontWeight: 'bold', textAlign: 'right' }}>{o.customerName}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>{o.customerCity || '-'}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>{o.partnerName || 'Direct'}</td>
                <td style={{ padding: '12px 0', fontWeight: 'bold', textAlign: 'right' }}>{formatCurrency(o.totalAmount)}</td>
                <td style={{ padding: '12px 0', fontWeight: '500', color: '#4f46e5', textAlign: 'right' }}>{formatCurrency(o.totalProfit || 0)}</td>
                <td style={{ padding: '12px 0', textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    fontSize: '9px',
                    backgroundColor: o.status === 'Delivered' ? '#ecfdf5' : o.status === 'Returned' ? '#fef2f2' : o.status === 'Cancelled' ? '#f3f4f6' : '#eef2ff',
                    color: o.status === 'Delivered' ? '#059669' : o.status === 'Returned' ? '#dc2626' : o.status === 'Cancelled' ? '#9ca3af' : '#4f46e5'
                  }}>
                    {o.status === 'Pending' ? 'زیر التواء' : o.status === 'Shipped' ? 'روانہ' : o.status === 'Delivered' ? 'پہنچ گیا' : o.status === 'Cancelled' ? 'کینسل' : o.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div style={{ marginTop: '48px', paddingTop: '32px', borderTop: '1px solid #f3f4f6', textAlign: 'center', fontSize: '12px', color: '#9ca3af' }}>
        <p>© {new Date().getFullYear()} ShipFlow Management System. All rights reserved.</p>
      </div>
    </div>
  );
}

// --- Modals ---

function ShippingLabel({ order, settings, labelRef }: { order: Order, settings: Settings | null, labelRef?: React.RefObject<HTMLDivElement | null> }) {
  const displayAmount = `Rs ${order.totalAmount.toLocaleString()}`;
  const qrValue = `Name: ${order.customerName || 'N/A'}\nAddress: ${order.customerAddress || ''}, ${order.customerCity || ''}\nPhone: ${order.customerPhone || 'N/A'}${order.customerPhone2 ? ', ' + order.customerPhone2 : ''}\nAmount: ${order.totalAmount}`;
  
  const isPakistanPost = !order.carrier || order.carrier === 'Pakistan Post';
  const labelHeader = isPakistanPost ? order.labelType : order.carrier.toUpperCase();
  
  return (
    <div ref={labelRef} style={{ width: '350px', backgroundColor: '#ffffff', border: '3px solid #000000', padding: '20px', color: '#000000', fontFamily: '"Inter", sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000000', paddingBottom: '12px', marginBottom: '16px' }}>
        <div style={{ fontSize: '24px', fontWeight: '900', letterSpacing: '-0.05em' }}>{labelHeader}</div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', margin: 0, opacity: 0.6 }}>Tracking Number</p>
          <p style={{ fontSize: '16px', fontWeight: '900', margin: 0 }}>{order.trackingNumber}</p>
        </div>
      </div>

      <div style={{ marginBottom: '24px', textAlign: 'left' }}>
        <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#666', marginBottom: '8px' }}>DELIVER TO:</p>
        <p style={{ fontSize: '22px', fontWeight: '900', lineHeight: '1.2', margin: '0 0 8px 0' }}>{order.customerName || 'No Name'}</p>
        <p style={{ fontSize: '15px', lineHeight: '1.4', margin: '0 0 4px 0', whiteSpace: 'pre-wrap' }}>{order.customerAddress || 'Address Missing'}</p>
        <p style={{ fontSize: '16px', fontWeight: 'bold', lineHeight: '1.2', margin: '0 0 8px 0' }}>{order.customerCity}</p>
        <div style={{ fontSize: '18px', fontWeight: '900', marginTop: '8px', fontFamily: 'monospace' }}>
          {order.customerPhone}{order.customerPhone2 ? ` / ${order.customerPhone2}` : ''}
        </div>
        {order.customerCNIC && <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>CNIC: {order.customerCNIC}</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '16px', padding: '10px 0', borderTop: '2.5px solid #000000', borderBottom: '2.5px solid #000000', textAlign: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: '#666', margin: 0 }}>Total COD Amount</p>
          <p style={{ fontSize: '32px', fontWeight: '900', margin: '2px 0' }}>{displayAmount}</p>
          <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#000000', margin: 0 }}>
            {isPakistanPost ? (order.labelType === 'VPL' ? 'VPL' : 'COD / VPP') : 'CASH ON DELIVERY (COD)'}
          </p>
        </div>
      </div>
      
      <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '3px solid #000000', textAlign: 'left' }}>
        <p style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#666', marginBottom: '6px' }}>FROM (RETURN ADDRESS):</p>
        {settings ? (
          <>
            <p style={{ fontSize: '14px', fontWeight: 'bold', lineHeight: '1.2', margin: '0 0 4px 0' }}>{settings.senderName}</p>
            <p style={{ fontSize: '11px', lineHeight: '1.3', margin: '0 0 4px 0' }}>{settings.senderAddress}, {settings.senderCity}</p>
            <p style={{ fontSize: '12px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{settings.senderPhone}</p>
            {settings.senderCNIC && <p style={{ fontSize: '12px', fontWeight: 'bold', margin: 0 }}>CNIC: {settings.senderCNIC}</p>}
          </>
        ) : (
          <p style={{ fontSize: '11px', color: '#ef4444', fontStyle: 'italic' }}>Please set up sender details in Settings</p>
        )}
      </div>

      {/* Post Office / Delivery Note */}
      <div style={{ marginTop: '14px', border: '2px solid #dc2626', padding: '10px', borderRadius: '6px', backgroundColor: '#fef2f2', textAlign: 'right' }}>
        <p style={{ fontSize: '15px', fontWeight: '900', color: '#dc2626', margin: '0 0 6px 0', textAlign: 'center' }}>
          ⚠️ توجہ فرمائیں
        </p>
        <p style={{ fontSize: '12.5px', fontWeight: '900', lineHeight: '1.5', margin: 0, color: '#000000' }}>
          بلاوجہ پارسل واپس کرنا ناقابلِ قبول ہے۔ ایسی صورت میں متعلقہ حکام کو شکایت کی جائے گی۔ پارسل ریٹرن کرنے سے قبل بھیجنے والے سے رابطہ اور منظوری ضروری ہے۔
        </p>
      </div>

      <div style={{ marginTop: '16px', textAlign: 'center', borderTop: '1px dashed #ccc', paddingTop: '8px' }}>
        <p style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#666' }}>Thank you for shopping with us!</p>
      </div>
    </div>
  );
}

function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

  if (num === 0) return 'Zero';

  function convert(n: number): string {
    let res = '';
    if (n >= 100000) {
      res += convert(Math.floor(n / 100000)) + ' Lakh ';
      n %= 100000;
    }
    if (n >= 1000) {
      res += convert(Math.floor(n / 1000)) + ' Thousand ';
      n %= 1000;
    }
    if (n >= 100) {
      res += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      res += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    } else if (n >= 10) {
      res += teens[n - 10] + ' ';
      n = 0;
    }
    if (n > 0) {
      res += ones[n] + ' ';
    }
    return res.trim();
  }

  return convert(num) + ' Only';
}

function ParcelTracker({ initialId = "", initialCarrier = "" }: { initialId?: string; initialCarrier?: string }) {
  const [trackingId, setTrackingId] = useState(initialId);
  
  const [courier, setCourier] = useState(() => mapCarrierToCourier(initialCarrier, initialId));
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const performTracking = async (id: string, carrier: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/track/${carrier}/${id}`);
      const data = await res.json();
      setResult(data);
      toast.success('معلومات موصول ہو گئی ہیں!');
    } catch (err) {
      toast.error('ٹریکنگ میں خرابی آئی ہے');
    } finally {
      setLoading(false);
    }
  };

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    performTracking(trackingId, courier);
  };

  useEffect(() => {
    if (initialId) {
      setTrackingId(initialId);
      const targetCourier = mapCarrierToCourier(initialCarrier, initialId);
      setCourier(targetCourier);
      performTracking(initialId, targetCourier);
    }
  }, [initialId, initialCarrier]);

  return (
    <Card className="max-w-2xl mx-auto shadow-xl border-indigo-100 overflow-hidden" dir="rtl">
      <div className="bg-indigo-600 p-6 text-white text-center">
        <Truck className="w-12 h-12 mx-auto mb-2 opacity-80" />
        <h3 className="text-2xl font-bold">پارسل ٹریکنگ سسٹم</h3>
        <p className="text-indigo-100 text-sm">پاکستان پوسٹ، لیپرڈ اور TCS ٹریک کریں</p>
      </div>
      
      <div className="p-6">
        <form onSubmit={handleTrack} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>کورئیر کمپنی</Label>
              <select 
                className="w-full h-11 px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 transition-all font-bold"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              >
                <option value="pakpost">پاکستان پوسٹ (Pak Post)</option>
                <option value="leopards">لیپرڈ کورئیر (Leopards)</option>
                <option value="tcs">TCS کورئیر</option>
              </select>
            </div>
            <div>
              <Label>ٹریکنگ آئی ڈی (ID)</Label>
              <Input 
                className="h-11 font-bold text-center tracking-wider"
                placeholder="CP123456789PK" 
                value={trackingId}
                onChange={(e: any) => setTrackingId(e.target.value)}
              />
            </div>
          </div>
          <Button className="w-full h-12 text-lg font-bold shadow-lg shadow-indigo-200" disabled={loading}>
            {loading ? 'تلاش ہو رہا ہے...' : 'اسٹیٹس چیک کریں'}
          </Button>
        </form>

        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-8"
            >
              <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-2xl border border-indigo-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                   <Package className="w-32 h-32" />
                </div>

                <div className="flex justify-between items-start mb-8 relative z-10">
                  <div className="text-right">
                    <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-1">Status</p>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                       <span className="text-xl md:text-2xl font-black text-indigo-900 leading-none">{result.trackingId}</span>
                       <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-black rounded uppercase inline-block max-w-[150px] truncate">{result.status}</span>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-1">Update</p>
                    <p className="text-sm font-bold text-indigo-900">{result.lastUpdate}</p>
                    <p className="text-[10px] text-indigo-400">{result.location}</p>
                  </div>
                </div>

                <div className="space-y-6 relative z-10 mr-4">
                   {result.events && result.events.length > 0 ? (
                     result.events.map((event: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-4">
                          <div className={cn(
                            "z-10 w-8 h-8 rounded-full flex items-center justify-center text-white ring-4 shrink-0",
                            idx === 0 ? "bg-indigo-600 ring-indigo-50 shadow-md" : "bg-emerald-500 ring-emerald-50"
                          )}>
                             {idx === 0 ? <Truck className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </div>
                          <div className={cn(
                            "flex-1 pr-6 -mr-4 relative",
                            idx !== result.events.length - 1 ? "pb-8 border-r-2 border-indigo-100" : ""
                          )}>
                             <p className="font-bold text-indigo-900 text-base leading-none mb-1">{event.status}</p>
                             <p className="text-sm text-indigo-600 font-medium mb-1">{event.location}</p>
                             <div className="flex items-center gap-1 text-[10px] text-gray-400">
                               <Clock className="w-3 h-3" />
                               {event.date}
                             </div>
                          </div>
                        </div>
                     ))
                   ) : (
                     <div className="text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <Box className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                        <p className="text-xs text-gray-500">تفصیلی اسٹیٹس دیکھنے کے لیے ویب سائٹ کا بٹن دبائیں</p>
                     </div>
                   )}
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3 relative z-10">
                  <Button 
                     variant="secondary" 
                     className="gap-2 bg-white text-xs"
                     onClick={() => window.open(result.trackingUrl, '_blank')}
                  >
                    ویب سائٹ پر دیکھیں
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                  <Button 
                     variant="secondary" 
                     className="gap-2 bg-white text-xs"
                     onClick={() => {
                        const msg = `آرڈر ٹریکنگ آئی ڈی: ${result.trackingId}\nاسٹیٹس: ${result.status}\nپاکستان پوسٹ ٹریکنگ لنک: ${result.trackingUrl}`;
                        toast.success('تفصیلات کاپی ہو گئیں!');
                        navigator.clipboard.writeText(msg);
                     }}
                  >
                    کاپی کریں
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

function MoneyOrder({ 
  order, 
  settings, 
  dataOnly = false,
  topOffset = 0,
  leftOffset = 0,
  isCalibrating = false
}: { 
  order: Order, 
  settings: Settings | null, 
  dataOnly?: boolean,
  topOffset?: number,
  leftOffset?: number,
  isCalibrating?: boolean
}) {
  return (
    <MoneyOrderCalibrator
      order={order}
      settings={settings}
      dataOnly={dataOnly}
      topOffset={topOffset}
      leftOffset={leftOffset}
      isCalibrating={isCalibrating}
    />
  );
}

function LegacyMoneyOrder({
  order,
  settings,
  dataOnly = false,
  topOffset = 0,
  leftOffset = 0
}: {
  order: Order,
  settings: Settings | null,
  dataOnly?: boolean,
  topOffset?: number,
  leftOffset?: number
}) {
  const today = format(new Date(), 'dd-MM-yyyy');
  const urduText = { fontFamily: '"Noto Sans Arabic", "Urdu Typesetting", "Jameel Noori Nastaleeq", serif', direction: 'rtl' as const, textAlign: 'right' as const };
  const hideStatic: { visibility: 'hidden' | 'visible' } = { visibility: dataOnly ? 'hidden' : 'visible' };
  const lineBorder = dataOnly ? '1px solid transparent' : '1px solid #000';
  const boxBorder = dataOnly ? '1px solid transparent' : '1px solid #000';
  const outerBorder = dataOnly ? '1px solid transparent' : '1px solid #000';

  return (
    <div style={{ width: '210mm', margin: '0 auto', color: '#000', fontFamily: 'sans-serif', backgroundColor: dataOnly ? 'transparent' : '#fff' }}>
      {/* PAGE 1: FRONT PAGE (OFFICIAL C.O.D. MONEY ORDER FORM) */}
      <div style={{ 
        width: '210mm', 
        height: '297mm', 
        backgroundColor: dataOnly ? 'transparent' : '#ffffff', 
        padding: '10mm 15mm', 
        boxSizing: 'border-box', 
        position: 'relative', 
        overflow: 'hidden',
        border: outerBorder,
        transform: `translate(${leftOffset}mm, ${topOffset}mm)`,
        transition: 'transform 0.1s ease'
      }}>
        
        {/* TOP STAMPS ROW */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-start', marginBottom: '15px' }}>
          <div style={{ textAlign: 'center', marginLeft: '20px' }}>
            <div style={{ fontSize: '13px', marginBottom: '4px', ...hideStatic }}>Month Stamp</div>
            <div style={{ width: '70px', height: '70px', border: boxBorder, backgroundColor: 'transparent' }}></div>
          </div>

          <div style={{ textAlign: 'center', marginLeft: '50px' }}>
            <div style={{ fontSize: '13px', marginBottom: '4px', ...hideStatic }}>Oblong M. O. Stamp on Issue</div>
            <div style={{ width: '260px', height: '70px', border: boxBorder, backgroundColor: 'transparent' }}></div>
          </div>
        </div>

        {/* COD & UMO NO ROW */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', fontSize: '12px' }}>
          <div style={{ width: '85px', textAlign: 'center', fontSize: '11px', fontWeight: 'normal', lineHeight: '1.2', ...hideStatic }}>
            <div>COD (Letter)</div>
            <div style={{ borderTop: lineBorder, margin: '2px 0' }}></div>
            <div>COD (Parcel)</div>
          </div>

          <div style={{ marginLeft: '15px', display: 'flex', alignItems: 'flex-end', gap: '8px', flex: 1 }}>
            <span style={{ fontSize: '13px', whiteSpace: 'nowrap', ...hideStatic }}>U. M. O. No.</span>
            <div style={{ borderBottom: lineBorder, width: '220px', textAlign: 'center', fontWeight: 'bold', fontSize: '13px', paddingBottom: '1px' }}>
              {order.trackingNumber}
            </div>
            <span style={{ fontSize: '13px', marginLeft: '15px', whiteSpace: 'nowrap', ...hideStatic }}>date</span>
            <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '13px', paddingBottom: '1px' }}>
              {today}
            </div>
          </div>
        </div>

        {/* FOR RS. AND COD ARTICLE ROW */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
            <span style={{ fontSize: '13px', marginRight: '6px', ...hideStatic }}>For</span>
            <span style={{ fontSize: '13px', marginRight: '6px', ...hideStatic }}>Rs.</span>
            <div style={{ border: boxBorder, width: '150px', height: '38px', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
              {order.totalAmount}
            </div>
          </div>
          
          <div style={{ marginLeft: '25px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
              <span style={{ fontSize: '13px', whiteSpace: 'nowrap', ...hideStatic }}>No. of C.O.D Article</span>
              <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '13px', paddingBottom: '1px' }}>
                {order.trackingNumber}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
              <span style={{ fontSize: '13px', whiteSpace: 'nowrap', ...hideStatic }}>(In words):</span>
              <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 'bold', paddingBottom: '1px' }}>
                {numberToWords(order.totalAmount)}
              </div>
            </div>
          </div>
        </div>

        {/* UMO CLERK & ISSUING POSTMASTER ROW */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '15px 0 15px 0' }}>
          <div style={{ display: 'flex', gap: '8px', width: '45%' }}>
            <span style={hideStatic}>UMO Clerk</span>
            <div style={{ borderBottom: lineBorder, flex: 1 }}></div>
          </div>
          <div style={{ display: 'flex', gap: '8px', width: '45%' }}>
            <span style={hideStatic}>Issuing Postmaster</span>
            <div style={{ borderBottom: lineBorder, flex: 1 }}></div>
          </div>
        </div>

        <div style={{ borderBottom: lineBorder, margin: '15px 0 15px 0' }}></div>

        {/* URDU CERTIFICATION BLOCK */}
        <div style={{ ...urduText, fontSize: '13px', lineHeight: '1.7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={hideStatic}>
              <div style={{ fontWeight: 'bold' }}>ذیل کے تمام اندراج بھیجنے والے کو کرنے ہیں :-</div>
              <div>تصدیق کی جاتی ہے کہ منسلک قیمت طلب (COD)</div>
              <div>کو باقاعدہ تحریری مطالبہ کے تحت، جو مجھے مل چکا ہے، بھیجا جا رہا ہے</div>
            </div>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '10px', marginLeft: '30px', ...hideStatic }}>
              <div style={{ borderBottom: lineBorder, width: '100px', paddingBottom: '2px', textAlign: 'center' }}>لیٹر</div>
              <div style={{ width: '100px', textAlign: 'center', marginTop: '2px' }}>پارسل</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginTop: '12px', whiteSpace: 'nowrap' }}>
            <span style={hideStatic}>رقم جو بھیجنے والے کو (ہندسوں میں)</span>
            <div style={{ borderBottom: lineBorder, width: '120px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px' }}>
              {order.totalAmount}
            </div>
            <span style={hideStatic}>روپیہ</span>
            <div style={{ borderBottom: lineBorder, width: '50px', textAlign: 'center' }}>00</div>
            <span style={hideStatic}>پیسہ</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginTop: '12px', whiteSpace: 'nowrap' }}>
            <span style={hideStatic}>ارسال ہوگی (عبارت میں)</span>
            <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '12px' }}>
              {numberToWords(order.totalAmount)}
            </div>
            <span style={hideStatic}>مبلغ</span>
            <span style={{ marginLeft: 'auto', ...hideStatic }}>فقط</span>
          </div>
        </div>

        {/* SENDER BLOCK (CUSTOMER DETAILS) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: '15px', ...urduText }}>
          <div style={{ fontSize: '12px', lineHeight: '2.0', marginLeft: '10px', width: '160px', flexShrink: 0, ...hideStatic }}>
            <div>بھیجنے والے کا نام،</div>
            <div>مکمل پتہ، ٹیلیفون نمبر،</div>
            <div>شناختی کارڈ نمبر اور</div>
            <div>رشتہ داری/تعلق/ذریعہ آمدن</div>
            <div>رقم بھیجنے کی وجہ</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', ...hideStatic }}>
            <svg width="22" height="130" viewBox="0 0 20 120" preserveAspectRatio="none">
              <path d="M20,0 C5,0 5,55 0,60 C5,65 5,120 20,120" fill="none" stroke="black" strokeWidth="1.5" />
            </svg>
          </div>
          <div style={{ flex: 1, marginRight: '15px', display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '2px' }}>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {order.customerName}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {order.customerAddress}, {order.customerCity} - {order.customerPhone}{order.customerPhone2 ? ` / ${order.customerPhone2}` : ''}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {order.customerCNIC || ''}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px' }}></div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => <div key={i} style={{ width: '28px', height: '28px', border: boxBorder, backgroundColor: 'transparent' }}></div>)}
            </div>
          </div>
        </div>

        {/* RECEIVER BLOCK (MY / SELLER DETAILS) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: '15px', ...urduText }}>
          <div style={{ fontSize: '12px', lineHeight: '2.0', marginLeft: '10px', width: '160px', flexShrink: 0, ...hideStatic }}>
            <div>وصول کرنے والے</div>
            <div>کا نام، مکمل پتہ،</div>
            <div>ٹیلیفون نمبر،</div>
            <div>شناختی کارڈ نمبر اور</div>
            <div>رشتہ داری/تعلق</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', ...hideStatic }}>
            <svg width="22" height="130" viewBox="0 0 20 120" preserveAspectRatio="none">
              <path d="M20,0 C5,0 5,55 0,60 C5,65 5,120 20,120" fill="none" stroke="black" strokeWidth="1.5" />
            </svg>
          </div>
          <div style={{ flex: 1, marginRight: '15px', display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '2px' }}>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {settings?.senderName || ''}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {settings?.senderAddress} - {settings?.senderPhone}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '24px', fontSize: '12px', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              {settings?.senderCNIC || ''}
            </div>
            <div style={{ borderBottom: lineBorder, width: '100%', height: '22px' }}></div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => <div key={i} style={{ width: '28px', height: '28px', border: boxBorder, backgroundColor: 'transparent' }}></div>)}
            </div>
          </div>
        </div>

        {/* DATE AND SIGNATURE */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '20px', ...urduText, fontSize: '13px' }}>
          <div style={{ display: 'flex', gap: '10px', width: '45%' }}>
            <span style={hideStatic}>بھیجنے والے کے دستخط</span>
            <div style={{ borderBottom: lineBorder, flex: 1 }}></div>
          </div>
          <div style={{ display: 'flex', gap: '10px', width: '45%' }}>
            <span style={hideStatic}>تاریخ</span>
            <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center' }}>{today}</div>
          </div>
        </div>

        {/* INTIMATION SECTION */}
        <div style={{ borderTop: lineBorder, marginTop: '15px', paddingTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '25px', marginBottom: '10px', ...hideStatic }}>
            <span style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'serif' }}>"INTIMATION"</span>
            <span style={{ ...urduText, fontSize: '22px', fontWeight: 'bold' }}>اطلاع</span>
          </div>

          <div style={{ display: 'flex', gap: '20px' }}>
            {/* LEFT STAMP */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', width: '110px' }}>
              <div style={{ fontSize: '10px', marginBottom: '6px', textAlign: 'center', lineHeight: '1.2', ...hideStatic }}>Date stamp of<br/>the office of issue</div>
              <div style={{ width: '80px', height: '80px', border: boxBorder, borderRadius: '50%', backgroundColor: 'transparent' }}></div>
            </div>

            {/* RIGHT FORM FIELDS */}
            <div style={{ flex: 1, ...urduText, fontSize: '12px', lineHeight: '1.9' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={hideStatic}>مبلغ روپیہ</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '13px' }}></div>
                <span style={hideStatic}>پیسہ</span>
                <div style={{ borderBottom: lineBorder, width: '80px', textAlign: 'center' }}></div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={hideStatic}>برائے</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center' }}></div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={{ whiteSpace: 'nowrap', ...hideStatic }}>(دفتر اجراء کا نام)</span>
                <div style={{ borderBottom: lineBorder, flex: 1 }}></div>
                <span style={hideStatic}>پوسٹ کوڈ</span>
                <div style={{ display: 'flex', gap: '2px', marginBottom: '2px' }}>
                  {[1, 2, 3, 4, 5, 6].map(i => <div key={i} style={{ width: '18px', height: '18px', border: boxBorder, backgroundColor: 'transparent' }}></div>)}
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={{ fontWeight: 'bold', ...hideStatic }}>* قیمت طلب</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold' }}></div>
                <span style={hideStatic}>تاریخ</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center' }}></div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={hideStatic}>نمبر قطعہ</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold' }}></div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={hideStatic}>بنام</span>
                <div style={{ borderBottom: lineBorder, flex: 1, textAlign: 'center', fontWeight: 'bold' }}></div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                <span style={hideStatic}>پوسٹ کوڈ</span>
                <div style={{ display: 'flex', gap: '2px', marginBottom: '2px' }}>
                  {[1, 2, 3, 4, 5, 6].map(i => <div key={i} style={{ width: '18px', height: '18px', border: boxBorder, backgroundColor: 'transparent' }}></div>)}
                </div>
              </div>
              
              <div style={{ marginTop: '6px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', ...hideStatic }}>* یہاں لیٹر، پیکٹ یا پارسل، جو بھی صورت ہو تحریر کریں۔</div>
            </div>
          </div>
        </div>
      </div>

      {/* PAGE 2: BACK PAGE */}
      <div style={{ 
        width: '210mm', 
        height: '297mm', 
        backgroundColor: '#ffffff', 
        padding: '10mm 15mm', 
        boxSizing: 'border-box', 
        position: 'relative', 
        border: outerBorder, 
        overflow: 'hidden', 
        marginTop: '10mm',
        ...hideStatic
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold' }}>M.O.-51 (Revised)</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #000', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package className="w-6 h-6" />
              </div>
              <span style={{ fontSize: '20px', fontWeight: '900', letterSpacing: '0.5px' }}>PAKISTAN POST</span>
            </div>
            <div style={{ ...urduText, fontSize: '18px', fontWeight: 'bold', marginTop: '4px' }}>پاکستان پوسٹ</div>
          </div>
          <div style={{ width: '90px' }}></div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '22px', fontWeight: '900' }}>PAKISTAN MONEY ORDER</div>
          <div style={{ fontSize: '18px', marginTop: '8px' }}>Value Payable <span style={{ ...urduText, fontSize: '22px', fontWeight: 'bold', marginLeft: '12px' }}>قیمت طلب</span></div>
        </div>

        <div style={{ textAlign: 'center', ...urduText, fontSize: '24px', fontWeight: 'bold', margin: '35px 0', textDecoration: 'underline' }}>پوسٹ ماسٹر</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', ...urduText, fontSize: '15px' }}>
          <div style={{ border: '2px solid #000', padding: '20px', height: '130px', backgroundColor: '#fcfcfc' }}>
            یہاں منی آرڈر ادا کرنے والے پوسٹ آفس کا نام درج کریں جہاں پر قیمت طلب قطعہ (VP) تقسیم ہونا ہے
          </div>
          <div style={{ border: '2px solid #000', padding: '20px', height: '130px', backgroundColor: '#fcfcfc' }}>
            یہاں اس دفتر کا نام درج کریں جہاں پر قیمت طلب قطعہ (VP) تقسیم ہونا ہے
          </div>
        </div>

        <div style={{ marginTop: '50px', borderBottom: '2px solid #000', ...urduText, fontSize: '16px', paddingBottom: '10px' }}>
          وی پی جرنل میں کوائف منی آرڈر درج کرنے کی تاریخ: ________________________________________
        </div>

        <div style={{ marginTop: '50px', textAlign: 'center', ...urduText }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold' }}>دستخط گواہ</div>
          <div style={{ width: '400px', borderBottom: '2px solid #000', margin: '35px auto' }}></div>
        </div>

        <div style={{ marginTop: '60px', ...urduText, fontSize: '16px', lineHeight: '3' }}>
          <p>مختصر دستخط رجسٹری یا پارسل کلرک: ________________________________________</p>
          <p>دوسری طرف لکھی ہوئی رقم وصول پائی: ________________________________________</p>
          <p>نشان انگوٹھہ: ________________________________________</p>
        </div>

        <div style={{ marginTop: '50px', border: '2px solid #000', padding: '30px', ...urduText, fontSize: '16px', backgroundColor: '#fafafa' }}>
          <p style={{ fontWeight: 'bold', marginBottom: '20px' }}>دستخط، شناختی کارڈ نمبر وصول کنندہ (روشنائی سے):</p>
          <div style={{ height: '40px' }}></div>
          <p>میں نے ادا کیا: ________________________________________</p>
        </div>

        <div style={{ marginTop: '50px', textAlign: 'center', ...urduText, fontSize: '16px' }}>
          <p>دستخط اہلکار بمعہ تاریخ و عہدہ: ________________________________________</p>
        </div>

        <div style={{ marginTop: '60px', borderTop: '2px dashed #000', paddingTop: '20px', textAlign: 'center', fontSize: '14px', color: '#555' }}>
          ---------------------------------- یہاں سے تہہ کریں ----------------------------------
        </div>

        <div style={{ marginTop: '40px', textAlign: 'center', ...urduText, fontSize: '16px', fontWeight: 'bold' }}>
          قیمت ایک روپیہ جو کہ منی آرڈر کمیشن سے منہا نہیں ہوگی۔
        </div>
        
        <div style={{ position: 'absolute', bottom: '25px', left: '15mm', fontSize: '12px', color: '#666' }}>
          Pakistan Post Foundation (Press Division)
        </div>
      </div>
    </div>
  );
}

function ProductModal({ product, products, onClose }: any) {
  const suppliers = useMemo(() => {
    if (!products) return [];
    return Array.from(new Set(products.map((p: any) => p.supplierName).filter((name: any) => name && name.trim() !== '')));
  }, [products]);

  const [formData, setFormData] = useState<Partial<Product>>(product || {
    name: '',
    costPrice: 0,
    sellingPrice: 0,
    stock: 0,
    lowStockThreshold: 5,
    supplierName: '',
  });
  const [additionalStock, setAdditionalStock] = useState(0);
  const [stockReason, setStockReason] = useState('Purchase');
  const [stockDate, setStockDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleQuickDate = (type: 'today' | 'yesterday' | 'prevMonth' | 'prevMonthEnd') => {
    const now = new Date();
    if (type === 'today') {
      setStockDate(format(now, 'yyyy-MM-dd'));
    } else if (type === 'yesterday') {
      setStockDate(format(subDays(now, 1), 'yyyy-MM-dd'));
    } else if (type === 'prevMonth') {
      const pm = subMonths(now, 1);
      setStockDate(format(pm, 'yyyy-MM-15'));
    } else if (type === 'prevMonthEnd') {
      const pmEnd = lastDayOfMonth(subMonths(now, 1));
      setStockDate(format(pmEnd, 'yyyy-MM-dd'));
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const finalStock = (formData.stock || 0) + additionalStock;
    const chosenDate = stockDate ? new Date(`${stockDate}T12:00:00`) : new Date();
    const logCreatedAt = isNaN(chosenDate.getTime()) ? new Date().toISOString() : chosenDate.toISOString();

    const data = {
      ...formData,
      costPrice: formData.costPrice || 0,
      sellingPrice: formData.sellingPrice || 0,
      stock: finalStock,
      lowStockThreshold: formData.lowStockThreshold || 0,
      userId: product?.userId || auth.currentUser?.uid,
      createdAt: product?.createdAt || logCreatedAt,
    };

    try {
      let productId = product?.id;
      if (product) {
        await updateDoc(doc(db, 'products', product.id), data);
      } else {
        const docRef = await addDoc(collection(db, 'products'), data);
        productId = docRef.id;
      }

      // Log stock addition if any
      let quantityAdded = 0;
      if (product) {
        // If editing, log the explicit addition + any manual increase in the base stock field
        const baseStockChange = (formData.stock || 0) - product.stock;
        quantityAdded = additionalStock + (baseStockChange > 0 ? baseStockChange : 0);
      } else {
        // If new product, log the initial stock
        quantityAdded = formData.stock || 0;
      }

      if (quantityAdded > 0) {
        const stockLog: Omit<StockLog, 'id'> = {
          productId: productId!,
          productName: formData.name!,
          quantity: quantityAdded,
          costPrice: formData.costPrice || 0,
          totalCost: (formData.costPrice || 0) * quantityAdded,
          reason: product ? stockReason : 'Initial Stock',
          userId: auth.currentUser?.uid,
          createdAt: logCreatedAt,
        };
        await addDoc(collection(db, 'stockLogs'), stockLog);
      }

      toast.success(product ? 'پروڈکٹ میں تبدیلیاں محفوظ ہو گئیں!' : 'نئی پروڈکٹ اور اسٹاک کامیابی سے شامل ہو گئے!');
      onClose();
    } catch (error) {
      handleFirestoreError(error, product ? OperationType.UPDATE : OperationType.CREATE, 'products');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <h3 className="text-xl font-bold text-right text-slate-900">{product ? 'پروڈکٹ میں تبدیلی کریں' : 'نئی پروڈکٹ شامل کریں'}</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-right" dir="rtl">
          <div>
            <Label>پروڈکٹ کا نام</Label>
            <Input required value={formData.name} onChange={(e: any) => setFormData({ ...formData, name: e.target.value })} />
          </div>
          <div>
            <Label>مال سپلائر (خریداری کا بندہ)</Label>
            <Input 
              placeholder="مثلاً علی یا حمزہ (سپلائر کا نام)" 
              value={formData.supplierName || ''} 
              onChange={(e: any) => setFormData({ ...formData, supplierName: e.target.value })} 
              className="text-right h-9"
            />
            {suppliers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5 justify-start animate-fade-in" dir="rtl">
                {suppliers.map((sName: any) => (
                  <button
                    key={sName}
                    type="button"
                    onClick={() => setFormData({ ...formData, supplierName: sName })}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer shadow-xs",
                      formData.supplierName === sName 
                        ? "bg-teal-100 text-teal-700 border-teal-300 ring-2 ring-teal-200"
                        : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200"
                    )}
                  >
                    ✓ {sName}
                  </button>
                ))}
                {formData.supplierName && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, supplierName: '' })}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 cursor-pointer shadow-xs"
                  >
                    صاف کریں
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>قیمتِ خرید (لاگت)</Label>
              <Input type="number" step="0.01" required value={formData.costPrice || 0} onChange={(e: any) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <Label>قیمتِ فروخت</Label>
              <Input type="number" step="0.01" required value={formData.sellingPrice || 0} onChange={(e: any) => setFormData({ ...formData, sellingPrice: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{product ? 'موجودہ بنیادی اسٹاک' : 'ابتدائی اسٹاک (Initial Stock)'}</Label>
              <Input 
                type="number" 
                required 
                value={formData.stock || 0} 
                onChange={(e: any) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })} 
              />
            </div>
            <div>
              <Label>کم اسٹاک الرٹ</Label>
              <Input type="number" required value={formData.lowStockThreshold || 0} onChange={(e: any) => setFormData({ ...formData, lowStockThreshold: parseInt(e.target.value) || 0 })} />
            </div>
          </div>

          {/* Date Picker for Stock Entry / Backdating */}
          <div className="bg-indigo-50/70 p-3.5 rounded-2xl border border-indigo-150 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-indigo-950 mb-0 font-extrabold flex items-center gap-1 text-xs">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>اسٹاک انٹری کی تاریخ (خریداری / پچھلا مہینہ)</span>
              </Label>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                بیک ڈیٹ سپورٹ
              </span>
            </div>

            <div className="flex flex-wrap gap-1" dir="rtl">
              <button
                type="button"
                onClick={() => handleQuickDate('today')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
              >
                آج
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('yesterday')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
              >
                کل
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonth')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-indigo-800 hover:bg-indigo-100 border-indigo-200"
              >
                پچھلا مہینہ
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonthEnd')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-indigo-800 hover:bg-indigo-100 border-indigo-200"
              >
                پچھلے مہینے کا آخری دن
              </button>
            </div>

            <Input 
              type="date"
              required
              value={stockDate}
              onChange={(e: any) => setStockDate(e.target.value)}
              className="bg-white border-indigo-200 focus:ring-indigo-500 font-mono text-center font-bold h-9 text-xs"
            />
            <p className="text-[11px] text-indigo-600">
              * پچھلے مہینے یا کسی بھی پرانی تاریخ کو منتخب کر کے ریکارڈ محفوظ کر سکتے ہیں تاکہ ماہانہ حساب بالکل درست رہے۔
            </p>
          </div>

          {product && (
            <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-150 space-y-3">
              <Label className="text-emerald-900 mb-0 block font-bold">Add More Stock (مزید اسٹاک شامل کریں)</Label>
              <div className="flex gap-2">
                <Input 
                  type="number" 
                  placeholder="تعداد لکھیں..." 
                  value={additionalStock || ''} 
                  onChange={(e: any) => setAdditionalStock(parseInt(e.target.value) || 0)}
                  className="bg-white border-emerald-200 focus:ring-emerald-500 flex-1 font-bold"
                />
                <select 
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                  className="bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                >
                  <option value="Purchase">خریداری (Purchase)</option>
                  <option value="Previous Month Stock">پچھلے مہینے کا مال</option>
                  <option value="Correction">تصحیح (Correction)</option>
                  <option value="Return">واپسی (Return)</option>
                  <option value="Other">دیگر (Other)</option>
                </select>
              </div>
              <p className="text-xs text-emerald-700 font-medium">نیا کل اسٹاک ہو جائے گا: <strong>{(formData.stock || 0) + additionalStock}</strong></p>
            </div>
          )}
          <div className="flex gap-3 mt-8">
            <Button type="button" variant="secondary" className="flex-1 font-bold" onClick={onClose}>کینسل</Button>
            <Button type="submit" className="flex-1 font-bold">پروڈکٹ محفوظ کریں</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function QuickAddStockModal({ products, initialProduct, onClose }: { products: Product[]; initialProduct?: Product | null; onClose: () => void }) {
  const [selectedProductId, setSelectedProductId] = useState(initialProduct?.id || products[0]?.id || '');
  const [quantity, setQuantity] = useState<number | ''>(1);
  const [costPrice, setCostPrice] = useState<number | ''>('');
  const [reason, setReason] = useState('خریداری (Purchase)');
  const [customReason, setCustomReason] = useState('');
  const [stockDate, setStockDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  useEffect(() => {
    if (selectedProduct) {
      setCostPrice(selectedProduct.costPrice || 0);
    }
  }, [selectedProductId, selectedProduct]);

  const handleQuickDate = (type: 'today' | 'yesterday' | 'prevMonth' | 'prevMonthEnd') => {
    const now = new Date();
    if (type === 'today') {
      setStockDate(format(now, 'yyyy-MM-dd'));
    } else if (type === 'yesterday') {
      setStockDate(format(subDays(now, 1), 'yyyy-MM-dd'));
    } else if (type === 'prevMonth') {
      const pm = subMonths(now, 1);
      setStockDate(format(pm, 'yyyy-MM-15'));
    } else if (type === 'prevMonthEnd') {
      const pmEnd = lastDayOfMonth(subMonths(now, 1));
      setStockDate(format(pmEnd, 'yyyy-MM-dd'));
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!selectedProduct) {
      toast.error('براہ کرم کوئی پروڈکٹ منتخب کریں');
      return;
    }
    const numQty = typeof quantity === 'number' ? quantity : parseInt(quantity as any) || 0;
    if (numQty <= 0) {
      toast.error('براہ کرم درست تعداد درج کریں (1 یا اس سے زیادہ)');
      return;
    }
    const numCost = typeof costPrice === 'number' ? costPrice : parseFloat(costPrice as any) || (selectedProduct.costPrice || 0);
    const chosenDate = stockDate ? new Date(`${stockDate}T12:00:00`) : new Date();
    const createdAt = isNaN(chosenDate.getTime()) ? new Date().toISOString() : chosenDate.toISOString();
    const finalReason = reason === 'دیگر (Other)' && customReason.trim() ? customReason.trim() : reason;

    setIsSubmitting(true);
    try {
      // 1. Update product stock
      const newStock = (selectedProduct.stock || 0) + numQty;
      await updateDoc(doc(db, 'products', selectedProduct.id), {
        stock: newStock,
        ...(numCost > 0 ? { costPrice: numCost } : {})
      });

      // 2. Add stock log
      const stockLog: Omit<StockLog, 'id'> = {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity: numQty,
        costPrice: numCost,
        totalCost: numCost * numQty,
        reason: finalReason,
        userId: auth.currentUser?.uid,
        createdAt,
      };
      await addDoc(collection(db, 'stockLogs'), stockLog);

      toast.success(`🎉 ${numQty} ${selectedProduct.name} کا اسٹاک کامیابی سے درج ہو گیا! (${format(chosenDate, 'dd-MMM-yyyy')})`);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'stockLogs');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCalculated = (typeof quantity === 'number' ? quantity : parseInt(quantity as any) || 0) * (typeof costPrice === 'number' ? costPrice : parseFloat(costPrice as any) || 0);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg p-6 md:p-8 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
          <button 
            type="button" 
            onClick={onClose} 
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="text-right">
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2 justify-end">
              <span>اسٹاک انٹری (پرانا یا نیا اسٹاک)</span>
              <Package className="w-5 h-5 text-emerald-600" />
            </h3>
            <p className="text-xs text-slate-500 font-medium">پچھلے مہینے یا کسی بھی پرانی تاریخ کا اسٹاک حساب میں شامل کریں</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-right" dir="rtl">
          <div>
            <Label>پروڈکٹ منتخب کریں</Label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-sm focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
              required
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (موجودہ اسٹاک: {p.stock} | لاگت: {p.costPrice} روپے)
                </option>
              ))}
            </select>
          </div>

          <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-150 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-emerald-950 mb-0 font-extrabold flex items-center gap-1.5 text-xs">
                <Calendar className="w-4 h-4 text-emerald-600" />
                <span>اسٹاک انٹری کی تاریخ (Backdate Selection)</span>
              </Label>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                پچھلا مہینہ سپورٹڈ
              </span>
            </div>

            {/* Quick Date Pills */}
            <div className="flex flex-wrap gap-1.5" dir="rtl">
              <button
                type="button"
                onClick={() => handleQuickDate('today')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer",
                  stockDate === format(new Date(), 'yyyy-MM-dd')
                    ? "bg-emerald-600 text-white border-emerald-700 shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                )}
              >
                ⚡ آج ({format(new Date(), 'dd-MMM')})
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('yesterday')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer",
                  stockDate === format(subDays(new Date(), 1), 'yyyy-MM-dd')
                    ? "bg-emerald-600 text-white border-emerald-700 shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                )}
              >
                ⚡ کل ({format(subDays(new Date(), 1), 'dd-MMM')})
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonth')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer",
                  stockDate === format(subMonths(new Date(), 1), 'yyyy-MM-15')
                    ? "bg-emerald-600 text-white border-emerald-700 shadow-xs"
                    : "bg-white text-emerald-800 hover:bg-emerald-100/60 border-emerald-200"
                )}
              >
                🗓️ پچھلا مہینہ ({format(subMonths(new Date(), 1), 'MMM yyyy')})
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonthEnd')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer",
                  stockDate === format(lastDayOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd')
                    ? "bg-emerald-600 text-white border-emerald-700 shadow-xs"
                    : "bg-white text-emerald-800 hover:bg-emerald-100/60 border-emerald-200"
                )}
              >
                🗓️ پچھلے مہینے کا آخری دن ({format(lastDayOfMonth(subMonths(new Date(), 1)), 'dd-MMM')})
              </button>
            </div>

            <Input 
              type="date"
              required
              value={stockDate}
              onChange={(e: any) => setStockDate(e.target.value)}
              className="bg-white border-emerald-200 focus:ring-emerald-500 font-mono text-center font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>شامل کرنے کی تعداد (Qty Added)</Label>
              <Input 
                type="number" 
                min="1"
                required
                placeholder="مثلاً 10" 
                value={quantity} 
                onChange={(e: any) => setQuantity(e.target.value === '' ? '' : parseInt(e.target.value) || 0)} 
                className="font-bold text-center text-base"
              />
            </div>
            <div>
              <Label>قیمتِ خرید (فی آئٹم لاگت)</Label>
              <Input 
                type="number" 
                step="0.01" 
                min="0"
                required
                placeholder="0" 
                value={costPrice} 
                onChange={(e: any) => setCostPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)} 
                className="font-bold text-center text-base"
              />
            </div>
          </div>

          <div>
            <Label>اسٹاک اضافے کی وجہ / تفصیل</Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-sm focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none mb-2"
            >
              <option value="خریداری (Purchase)">خریداری (Purchase)</option>
              <option value="پچھلے مہینے کا اسٹاک (Previous Month Stock)">پچھلے مہینے کا اسٹاک (Previous Month Stock)</option>
              <option value="پرانا بقایا مال (Old Stock Balance)">پرانا بقایا مال (Old Stock Balance)</option>
              <option value="تصحیح / ایڈجسٹمنٹ (Correction / Adjustment)">تصحیح / ایڈجسٹمنٹ (Correction / Adjustment)</option>
              <option value="واپسی مال (Customer Return)">واپسی مال (Customer Return)</option>
              <option value="دیگر (Other)">دیگر (Other)</option>
            </select>
            {reason === 'دیگر (Other)' && (
              <Input 
                placeholder="تفصیل لکھیں..." 
                value={customReason} 
                onChange={(e: any) => setCustomReason(e.target.value)} 
                className="text-right"
              />
            )}
          </div>

          {selectedProduct && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs flex justify-between items-center text-slate-700 font-bold">
              <span>نیا کل اسٹاک ہو جائے گا: <strong className="text-emerald-700 font-extrabold">{(selectedProduct.stock || 0) + (typeof quantity === 'number' ? quantity : parseInt(quantity as any) || 0)}</strong></span>
              <span>کل خریدارانہ رقم: <strong className="text-emerald-700 font-extrabold">{formatCurrency(totalCalculated)}</strong></span>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" className="flex-1 font-bold" onClick={onClose} disabled={isSubmitting}>کینسل</Button>
            <Button type="submit" className="flex-1 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200" disabled={isSubmitting}>
              {isSubmitting ? 'محفوظ ہو رہا ہے...' : 'اسٹاک محفوظ کریں'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function EditStockLogModal({ log, products, orders, onClose }: any) {
  const [costPrice, setCostPrice] = useState(log?.costPrice || 0);
  const [quantity, setQuantity] = useState(log?.quantity || 0);
  const [reason, setReason] = useState(log?.reason || 'Purchase');
  const [logDate, setLogDate] = useState(() => {
    try {
      return log?.createdAt ? format(new Date(log.createdAt), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    } catch {
      return format(new Date(), 'yyyy-MM-dd');
    }
  });
  const [totalCost, setTotalCost] = useState(log?.totalCost || 0);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const numCost = parseFloat(costPrice as any) || 0;
    const numQty = parseInt(quantity as any) || 0;
    setTotalCost(numCost * numQty);
  }, [costPrice, quantity]);

  const handleQuickDate = (type: 'today' | 'yesterday' | 'prevMonth' | 'prevMonthEnd') => {
    const now = new Date();
    if (type === 'today') {
      setLogDate(format(now, 'yyyy-MM-dd'));
    } else if (type === 'yesterday') {
      setLogDate(format(subDays(now, 1), 'yyyy-MM-dd'));
    } else if (type === 'prevMonth') {
      const pm = subMonths(now, 1);
      setLogDate(format(pm, 'yyyy-MM-15'));
    } else if (type === 'prevMonthEnd') {
      const pmEnd = lastDayOfMonth(subMonths(now, 1));
      setLogDate(format(pmEnd, 'yyyy-MM-dd'));
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!log) return;
    setIsUpdating(true);
    try {
      const newCostPrice = parseFloat(costPrice as any) || 0;
      const newQty = parseInt(quantity as any) || 0;
      const calculatedTotal = newCostPrice * newQty;
      
      const chosenDate = logDate ? new Date(`${logDate}T12:00:00`) : new Date(log.createdAt);
      const newCreatedAt = isNaN(chosenDate.getTime()) ? (log.createdAt || new Date().toISOString()) : chosenDate.toISOString();

      await updateDoc(doc(db, 'stockLogs', log.id), {
        costPrice: newCostPrice,
        quantity: newQty,
        totalCost: calculatedTotal,
        reason: reason.trim(),
        createdAt: newCreatedAt
      });
      
      const product = products.find((p: Product) => p.id === log.productId);
      if (product) {
        const qtyDiff = newQty - (log.quantity || 0);
        const newProductStock = Math.max(0, (product.stock || 0) + qtyDiff);
        
        await updateDoc(doc(db, 'products', product.id), {
          stock: newProductStock,
          costPrice: newCostPrice
        });
        
        // Update totalProfit on existing orders involving this product if costPrice changed
        if (newCostPrice !== log.costPrice) {
          const batch = writeBatch(db);
          let count = 0;
          for (const order of orders || []) {
            let hasProduct = false;
            const updatedItems = order.items?.map((item: any) => {
              if (item.productId === log.productId) {
                hasProduct = true;
                return { ...item, cost: newCostPrice };
              }
              return item;
            }) || [];
            
            if (hasProduct) {
              const grossProfit = updatedItems.reduce((sum: number, i: any) => sum + (((i.price || 0) - (i.cost || 0)) * (i.quantity || 0)), 0);
              const updatedTotalProfit = grossProfit - (order.deliveryCharges || 0);
              
              batch.update(doc(db, 'orders', order.id), {
                items: updatedItems,
                totalProfit: updatedTotalProfit
              });
              count++;
              if (count >= 400) {
                  await batch.commit();
              }
            }
          }
          if (count > 0 && count < 400) {
            await batch.commit();
          }
        }
      }
      toast.success('اسٹاک لاگ کی تاریخ اور تفصیلات کامیابی سے اپڈیٹ ہو گئیں!');
      onClose();
    } catch (error) {
       handleFirestoreError(error, OperationType.UPDATE, `stockLogs/${log.id}`);
    } finally {
       setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-md p-6 md:p-8 shadow-2xl border border-slate-100"
      >
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <h3 className="text-xl font-bold text-right text-slate-900">اسٹاک لاگ اور تاریخ ایڈیٹ کریں</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-right" dir="rtl">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-xs text-slate-500 font-bold block">پروڈکٹ:</span>
            <span className="text-base font-extrabold text-slate-900">{log?.productName}</span>
          </div>

          <div className="bg-indigo-50/60 p-3.5 rounded-2xl border border-indigo-150 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-indigo-950 mb-0 font-bold flex items-center gap-1.5 text-xs">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <span>اندراج کی تاریخ (Log Date)</span>
              </Label>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                ماہ تبدیل کریں
              </span>
            </div>

            {/* Quick date pills */}
            <div className="flex flex-wrap gap-1" dir="rtl">
              <button
                type="button"
                onClick={() => handleQuickDate('today')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-slate-700 hover:bg-slate-50 border-slate-200 cursor-pointer"
              >
                آج
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('yesterday')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-slate-700 hover:bg-slate-50 border-slate-200 cursor-pointer"
              >
                کل
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonth')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-indigo-800 hover:bg-indigo-100 border-indigo-200 cursor-pointer"
              >
                پچھلا مہینہ
              </button>
              <button
                type="button"
                onClick={() => handleQuickDate('prevMonthEnd')}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg border bg-white text-indigo-800 hover:bg-indigo-100 border-indigo-200 cursor-pointer"
              >
                پچھلے مہینے کا آخری دن
              </button>
            </div>

            <Input 
              type="date"
              required
              value={logDate}
              onChange={(e: any) => setLogDate(e.target.value)}
              className="bg-white border-indigo-200 focus:ring-indigo-500 font-mono text-center font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>تعداد (Quantity)</Label>
              <Input 
                type="number" 
                min="1"
                required 
                value={quantity} 
                onChange={(e: any) => setQuantity(parseInt(e.target.value) || 0)} 
                className="font-bold text-center"
              />
            </div>
            <div>
              <Label>قیمتِ خرید (فی آئٹم)</Label>
              <Input 
                type="number" 
                step="0.01" 
                required 
                value={costPrice} 
                onChange={(e: any) => setCostPrice(parseFloat(e.target.value) || 0)} 
                className="font-bold text-center"
              />
            </div>
          </div>

          <div>
            <Label>وجہ / تفصیل (Reason)</Label>
            <Input 
              type="text" 
              required
              value={reason} 
              onChange={(e: any) => setReason(e.target.value)} 
              className="text-right font-medium"
            />
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs font-bold text-slate-700">
            <span>کل رقم: <strong className="text-indigo-700 text-sm font-extrabold">{formatCurrency(totalCost)}</strong></span>
          </div>

          <div className="flex gap-3 pt-3">
            <Button type="button" variant="secondary" className="flex-1 font-bold" onClick={onClose} disabled={isUpdating}>کینسل</Button>
            <Button type="submit" className="flex-1 font-bold" disabled={isUpdating}>
              {isUpdating ? 'محفوظ ہو رہا ہے...' : 'تبدیلیاں محفوظ کریں'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function OrderModal({ products, settings, existingOrder, orders, onClose }: any) {
  const partners = useMemo(() => {
    if (!orders) return [];
    return Array.from(new Set(orders.map((o: any) => o.partnerName).filter((name: any) => name && name.trim() !== '')));
  }, [orders]);

  const [productSearch, setProductSearch] = useState('');

  const uniqueModalProducts = useMemo(() => {
    const deduped = deduplicateProducts(products || []);
    if (!productSearch.trim()) return deduped;
    const query = normalizeUrduProductName(productSearch);
    return deduped.filter(p => 
      normalizeUrduProductName(p.name).includes(query) ||
      p.name.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [products, productSearch]);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
  const [matchedPastOrder, setMatchedPastOrder] = useState<any>(null);

  const handleApplyVoiceData = (data: ExtractedVoiceAddress) => {
    const resolvedAddress = data.customerAddress || formData.customerAddress || '';
    const resolvedCity = data.customerCity || formData.customerCity || '';

    setFormData(prev => {
      let updatedItems = [...(prev.items || [])];

      if (data.detectedItems && data.detectedItems.length > 0) {
        data.detectedItems.forEach((item: any) => {
          if (!item.name) return;
          const matchedProduct = products?.find((p: Product) => 
            p.name.toLowerCase().includes(item.name.toLowerCase()) || 
            item.name.toLowerCase().includes(p.name.toLowerCase())
          );
          if (matchedProduct) {
            const exists = updatedItems.find(i => i.productId === matchedProduct.id);
            if (exists) {
              updatedItems = updatedItems.map(i => 
                i.productId === matchedProduct.id 
                  ? { ...i, quantity: (i.quantity || 0) + (item.quantity || 1) } 
                  : i
              );
            } else {
              updatedItems.push({
                productId: matchedProduct.id,
                name: matchedProduct.name,
                quantity: item.quantity || 1,
                price: matchedProduct.sellingPrice || item.price || 0,
                cost: matchedProduct.costPrice || 0
              });
            }
          }
        });
      }

      return {
        ...prev,
        customerName: data.customerName || prev.customerName,
        customerPhone: data.customerPhone || prev.customerPhone,
        customerPhone2: data.customerPhone2 || prev.customerPhone2,
        customerCity: resolvedCity,
        customerAddress: resolvedAddress,
        customerCNIC: data.customerCNIC || prev.customerCNIC || generateCNICBasedOnAddress(resolvedAddress, resolvedCity),
        items: updatedItems.length > 0 ? updatedItems : prev.items
      };
    });
  };

  const normalizePhoneForLookup = (phone: string) => {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('92')) {
      cleaned = '0' + cleaned.substring(2);
    }
    return cleaned;
  };

  const [formData, setFormData] = useState<Partial<Order>>(existingOrder || {
    customerName: '',
    customerPhone: '',
    customerPhone2: '',
    customerAddress: '',
    customerCity: '',
    items: [],
    status: 'Pending',
    labelType: 'VPL',
    carrier: 'Pakistan Post',
    trackingNumber: generateTrackingNumber(),
    deliveryCharges: 0,
    partnerName: '',
    partnerProfitAmount: 0,
    paymentReceived: false,
    partnerPaid: false,
  });

  useEffect(() => {
    if (existingOrder) return;

    const p1 = formData.customerPhone || '';
    const p2 = formData.customerPhone2 || '';
    
    if (!p1 && !p2) {
      setMatchedPastOrder(null);
      return;
    }

    const t1 = normalizePhoneForLookup(p1);
    const t2 = normalizePhoneForLookup(p2);

    if (!t1 && !t2) {
      setMatchedPastOrder(null);
      return;
    }

    const found = orders?.find((o: any) => {
      const oPhone = normalizePhoneForLookup(o.customerPhone || '');
      const oPhone2 = normalizePhoneForLookup(o.customerPhone2 || '');
      
      const match1 = t1 && (oPhone === t1 || oPhone2 === t1);
      const match2 = t2 && (oPhone === t2 || oPhone2 === t2);
      
      return match1 || match2;
    });

    setMatchedPastOrder(found || null);
  }, [formData.customerPhone, formData.customerPhone2, orders, existingOrder]);

  const optimizeAddress = async () => {
    if (!formData.customerAddress) {
      toast.error('براہ کرم پہلے پتہ لکھیں');
      return;
    }
    setIsOptimizing(true);
    try {
      const response = await fetch('/api/optimize-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerAddress: formData.customerAddress,
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          customerCity: formData.customerCity
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Address optimization failed');
      }

      const data = await response.json();

      const resolvedAddress = data.customerAddress || formData.customerAddress || '';
      const resolvedCity = data.customerCity || formData.customerCity || '';

      setFormData({ 
        ...formData, 
        customerAddress: resolvedAddress,
        customerCNIC: data.customerCNIC || formData.customerCNIC || generateCNICBasedOnAddress(resolvedAddress, resolvedCity),
        ...(data.customerName && { customerName: data.customerName }),
        ...(data.customerPhone && { customerPhone: data.customerPhone }),
        ...(data.customerCity && { customerCity: data.customerCity })
      });
      toast.success('اے آئی کے ذریعے معلومات ٹھیک کر دی گئی ہیں!');
    } catch (e: any) {
      console.error("Optimization failed:", e);
      toast.error('کچھ غلطی ہوئی ہے، براہ کرم دوبارہ کوشش کریں');
    } finally {
      setIsOptimizing(false);
    }
  };

  const [error, setError] = useState<string | null>(null);

  const generateCNICBasedOnAddress = (address: string, city: string = '') => {
    let firstDigit = '3'; // Default Punjab
    const text = (address + ' ' + city).toLowerCase();
    
    if (text.match(/karachi|sindh|hyderabad|sukkur|larkana|nawabshah|mirpurkhas|jamshoro|badin|shikarpur|jacobabad/)) {
      firstDigit = '4'; // Sindh
    } else if (text.match(/peshawar|kpk|khyber|swat|mardan|kohat|abbottabad|nowshera|charsadda|bannu|dir|chitral|mansehra/)) {
      firstDigit = '1'; // KPK
    } else if (text.match(/fata|waziristan|kurram|khyber agency|orakzai|mohmand|bajaur/)) {
      firstDigit = '2'; // FATA
    } else if (text.match(/quetta|balochistan|gwadar|zhob|sibi|khuzdar|chaman|turbat|panjgur|loralai/)) {
      firstDigit = '5'; // Balochistan
    } else if (text.match(/islamabad|capital/)) {
      firstDigit = '6'; // Islamabad
    } else if (text.match(/gilgit|baltistan|skardu|hunza|chilas|ghizer|nagar/)) {
      firstDigit = '7'; // GB
    } else if (text.match(/kashmir|muzaffarabad|mirpur|rawalakot|bhimber|kotli/)) {
      firstDigit = '8'; // AJK
    }

    let rest = '';
    for (let i = 0; i < 12; i++) {
      rest += Math.floor(Math.random() * 10).toString();
    }
    return `${firstDigit}${rest}`;
  };

  const parseRawAddressDetails = (text: string) => {
    let extractedName = '';
    let extractedPhone = '';
    let extractedPhone2 = '';
    let extractedCity = '';
    let cleanedAddress = text;

    // 1. Extract phone numbers first (starts with 03 or +923 or 923, 10 to 12 digits)
    const phoneRegex = /(?:03|\+?92\s*3)[0-9\-\s]{9,12}/g;
    const foundPhones = (text.match(phoneRegex) || []) as string[];
    const normalizedPhones: string[] = [];
    
    foundPhones.forEach(ph => {
      let ext = ph.replace(/[\-\s\+]/g, '');
      if (ext.startsWith('92')) {
        ext = '0' + ext.substring(2);
      }
      if (ext.length >= 11 && ext.length <= 13) {
        normalizedPhones.push(ext);
        cleanedAddress = cleanedAddress.replace(ph, '');
      }
    });

    if (normalizedPhones.length > 0) {
      extractedPhone = normalizedPhones[0];
      if (normalizedPhones.length > 1) {
        extractedPhone2 = normalizedPhones[1];
      }
    }

    // 2. Extract city using common Pakistani cities with boundary-safe regex (avoiding lookbehinds on client-side)
    const cityMap: { [key: string]: string } = {
      "کراچی": "Karachi", "لاہور": "Lahore", "اسلام آباد": "Islamabad", "راولپنڈی": "Rawalpindi",
      "فیصل آباد": "Faisalabad", "ملتان": "Multan", "پشاور": "Peshawar", "کوئٹہ": "Quetta",
      "حیدرآباد": "Hyderabad", "گوجرانوالہ": "Gujranwala", "سیالکوٹ": "Sialkot", "ایبٹ آباد": "Abbottabad",
      "بہاولپور": "Bahawalpur", "سرگودھا": "Sargodha", "سکھر": "Sukkur", "سوات": "Swat",
      "مردان": "Mardan", "گجرات": "Gujrat", "جھنگ": "Jhang", "ساہیوال": "Sahiwal",
      "نوابشاہ": "Nawabshah", "میانوالی": "Mianwali", "میرپور": "Mirpur", "مظفرآباد": "Muzaffarabad",
      "گلگت": "Gilgit", "اسکردو": "Skardu", "سکردو": "Skardu", "ہنزہ": "Hunza",
      "karachi": "Karachi", "lahore": "Lahore", "islamabad": "Islamabad", "rawalpindi": "Rawalpindi",
      "faisalabad": "Faisalabad", "multan": "Multan", "peshawar": "Peshawar", "quetta": "Quetta",
      "hyderabad": "Hyderabad", "gujranwala": "Gujranwala", "sialkot": "Sialkot", "abbottabad": "Abbottabad",
      "bahawalpur": "Bahawalpur", "sargodha": "Sargodha", "sukkur": "Sukkur", "swat": "Swat",
      "mardan": "Mardan", "gujrat": "Gujrat", "jhang": "Jhang", "sahiwal": "Sahiwal",
      "nawabshah": "Nawabshah", "mianwali": "Mianwali", "mirpur": "Mirpur", "muzaffarabad": "Muzaffarabad",
      "gilgit": "Gilgit", "skardu": "Skardu", "hunza": "Hunza", "swabi": "Swabi", "kohat": "Kohat",
      "nowshera": "Nowshera", "charsadda": "Charsadda", "bannu": "Bannu", "sheikhupura": "Sheikhupura",
      "kasur": "Kasur", "okara": "Okara", "rahim yar khan": "Rahim Yar Khan", "rahimyar khan": "Rahim Yar Khan",
      "chiniot": "Chiniot", "kamoke": "Kamoke", "sadiqabad": "Sadiqabad", "turbat": "Turbat",
      "shikarpur": "Shikarpur", "hafizabad": "Hafizabad", "jhelum": "Jhelum", "khanewal": "Khanewal",
      "khairpur": "Khairpur", "dadu": "Dadu", "gojra": "Gojra", "muridke": "Muridke",
      "bahawalnagar": "Bahawalnagar", "pakpattan": "Pakpattan", "toba tek singh": "Toba Tek Singh",
      "tobatek singh": "Toba Tek Singh", "tts": "Toba Tek Singh", "vehari": "Vehari",
      "shorkot": "Shorkot", "pattoki": "Pattoki", "wazirabad": "Wazirabad", "gwadar": "Gwadar",
      "attock": "Attock", "bhakkar": "Bhakkar", "layyah": "Layyah", "rajanpur": "Rajanpur",
      "muzaffargarh": "Muzaffargarh", "ghotki": "Ghotki", "jacobabad": "Jacobabad", "kashmore": "Kashmore",
      "larkana": "Larkana", "qambar": "Qambar", "jamshoro": "Jamshoro", "matiari": "Matiari",
      "tando allahyar": "Tando Allahyar", "tando muhammad khan": "Tando Muhammad Khan", "badin": "Badin",
      "sujawal": "Sujawal", "thatta": "Thatta", "malir": "Malir", "korangi": "Korangi", "keamari": "Keamari",
      "haripur": "Haripur", "karak": "Karak"
    };

    const pakCities = Object.keys(cityMap);
    pakCities.sort((a, b) => b.length - a.length);

    const getBoundarySafeRegex = (word: string) => {
      if (/[\u0600-\u06FF]/.test(word)) {
        return new RegExp("(?:^|[^\\u0600-\\u06FF])(" + word + ")(?:$|[^\\u0600-\\u06FF])", "i");
      } else {
        return new RegExp("\\b(" + word + ")\\b", "i");
      }
    };

    for (const city of pakCities) {
      const regex = getBoundarySafeRegex(city);
      const match = cleanedAddress.match(regex);
      if (match && match.index !== undefined) {
        const matchedCityName = match[1];
        extractedCity = cityMap[city.toLowerCase()] || city;
        const wordIndex = match.index + match[0].indexOf(matchedCityName);
        cleanedAddress = cleanedAddress.substring(0, wordIndex) + cleanedAddress.substring(wordIndex + matchedCityName.length);
        break;
      }
    }

    if (extractedCity && /^[a-zA-Z\s]+$/.test(extractedCity)) {
      extractedCity = extractedCity.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());
    }

    // 3. Extract Name using labels or contextual triggers with advanced Pakistani/Muslim name parser
    const nameLabelRegex = /(?:Name|نام|گاہک کا نام|کسٹمر|موصول کنندہ|Receiver|Customer|Client|بھجوانے والا)\s*[:\-\.۔]*\s*([A-Za-z\u0600-\u06FF\s]+?)(?:[,\n\r]|$)/i;
    const nameMatch = cleanedAddress.match(nameLabelRegex);
    if (nameMatch && nameMatch[1].trim().length > 2) {
      extractedName = nameMatch[1].trim();
      cleanedAddress = cleanedAddress.replace(nameMatch[0], '').trim();
    } else {
      const commonUrduNames = [
        "محمد", "علی", "احمد", "خان", "عمران", "بلال", "حمزہ", "عثمان", "حذیفہ", "طلحہ", 
        "انس", "جنید", "عمر", "ابوبکر", "زبیر", "یاسر", "عرفان", "فیصل", "نعمان", "رضوان", 
        "عدنان", "کامران", "سلمان", "شہزاد", "کاشف", "شاہد", "آصف", "وقار", "طارق", "ساجد", 
        "ماجد", "امجد", "اسد", "حسن", "حسین", "طاہر", "ظفر", "اقبال", "ثاقب", "وقاص", 
        "نوید", "جواد", "شفیق", "خالد", "فیاض", "اصغر", "اکرم", "ارسلان", "ہارون", "ذیشان", 
        "زیشان", "آفتاب", "فراز", "عمیر", "سفیان", "سعد", "معاذ", "عامر", "شعیب", "بابر", 
        "طہ", "طٰہٰ", "بشارت", "امتیاز", "ممتاز", "ریاض", "فہیم", "عاطف", "ندیم", "وسیم", 
        "سہیل", "مظہر", "تنویر", "منیر", "نواز", "شہباز", "رحمان", "شریف", "لطیف", "جمیل", 
        "حبیب", "بشیر", "شاکر", "صابر", "ظاہر", "قاسم", "رحیم", "کریم", "آفتاب", "بشارت"
      ];

      const commonEngNames = [
        "muhammad", "ali", "ahmad", "ahmed", "khan", "imran", "bilal", "hamza", "usman", "huzaifa",
        "talha", "anas", "junaid", "umer", "umar", "abubakar", "zubair", "yasir", "irfan", "faisal",
        "noman", "nouman", "rizwan", "adnan", "kamran", "salman", "shahzad", "kashif", "shahid", "asif",
        "waqar", "tariq", "sajid", "majid", "amjad", "asad", "hasan", "hassan", "husain", "hussain",
        "tahir", "zafar", "iqbal", "saqib", "waqas", "naveed", "jawad", "shafiq", "khalid", "fayyaz",
        "asghar", "akram", "arslan", "haroon", "zeeshan", "aftab", "faraz", "umair", "sufyan", "saad",
        "maaz", "aamir", "amir", "shoaib", "babar", "taha", "imtiaz", "mumtaz", "riaz", "faheem",
        "fahim", "atif", "nadeem", "waseem", "sohail", "mazhar", "tanveer", "munir", "nawaz", "shahbaz",
        "rehman", "basit", "raza"
      ];

      const landmarkPrefixes = [
        "مسجد", "جامع مسجد", "امام بارگاہ", "مزار", "اسکول", "سکول", "کالج", "مدرسہ", "دربار", "چوک", "روڈ", "ٹاؤن", "کالونی", "بلاک", "سیکٹر", "فیز", "گلی", "کوٹ", "ڈھوک", "پنڈ", "موضع", "مکان", "دوکان", "دکان", "شاپ", "کیفے", "ہوٹل", "ہاؤس",
        "mosque", "masjid", "school", "college", "road", "chowk", "town", "colony", "block", "sector", "phase", "street", "gali", "shop", "cafe", "hotel", "house"
      ];

      // Helper to check if a name is preceded by a landmark prefix within 2-3 words
      const isPartofLandmark = (fullText: string, name: string, nameIndex: number) => {
        const precedingText = fullText.substring(0, nameIndex).trim();
        if (!precedingText) return false;
        const samplePreceding = precedingText.substring(precedingText.length - 25).trim();
        const words = samplePreceding.split(/[\s,;\-\:۔\.\/]+/).filter(Boolean);
        const wordsToCheck = words.slice(-3);
        return wordsToCheck.some(w => landmarkPrefixes.some(p => p.toLowerCase() === w.toLowerCase()));
      };

      interface FoundNameInfo {
        name: string;
        index: number;
        isUrdu: boolean;
      }

      const candidates: FoundNameInfo[] = [];

      // Scan Urdu names
      commonUrduNames.forEach(name => {
        let index = cleanedAddress.indexOf(name);
        while (index !== -1) {
          const beforeChar = index > 0 ? cleanedAddress.charAt(index - 1) : '';
          const afterChar = index + name.length < cleanedAddress.length ? cleanedAddress.charAt(index + name.length) : '';
          const isWordBoundaryBefore = !beforeChar || /[\s,;\-\:۔\.\/\d]/.test(beforeChar);
          const isWordBoundaryAfter = !afterChar || /[\s,;\-\:۔\.\/\d]/.test(afterChar);
          
          if (isWordBoundaryBefore && isWordBoundaryAfter && !isPartofLandmark(cleanedAddress, name, index)) {
            candidates.push({ name, index, isUrdu: true });
          }
          index = cleanedAddress.indexOf(name, index + 1);
        }
      });

      // Scan English names
      commonEngNames.forEach(name => {
        const regex = new RegExp(`\\b${name}\\b`, 'gi');
        let match;
        while ((match = regex.exec(cleanedAddress)) !== null) {
          if (!isPartofLandmark(cleanedAddress, match[0], match.index)) {
            candidates.push({ name: match[0], index: match.index, isUrdu: false });
          }
        }
      });

      candidates.sort((a, b) => a.index - b.index);

      if (candidates.length > 0) {
        let mergedName = candidates[0].name;
        let lastEndIndex = candidates[0].index + candidates[0].name.length;
        
        for (let i = 1; i < candidates.length; i++) {
          const nextName = candidates[i];
          const gap = cleanedAddress.substring(lastEndIndex, nextName.index);
          if (/^[\s,;\-\:۔\.\/]*$/.test(gap)) {
            mergedName += gap + nextName.name;
            lastEndIndex = nextName.index + nextName.name.length;
          } else {
            break;
          }
        }

        // Check if followed immediately by business/shop suffix
        const followingText = cleanedAddress.substring(lastEndIndex);
        const matchFollowing = followingText.match(/^([\s,;\-\:۔\.\/]+)(موبائل|موبائیل|شاپ|سٹور|اسٹور|سینٹر|سینڑ|الیکٹرانکس|ٹیلر|بوتیک|بیکری|مارٹ|mobile|shop|store|center|electronics|tailor|bakery|mart)\b/i);
        if (matchFollowing) {
          mergedName += matchFollowing[1] + matchFollowing[2];
        }

        if (mergedName.length > 2) {
          extractedName = mergedName;
          cleanedAddress = cleanedAddress.replace(mergedName, '').trim();
        }
      } else {
        // Fallback: Look for the first occurrence of any address indicator or digit to find name at the start
        let earliestIndex = -1;
        const numberRegex = /\b\d+\b/;
        const numberMatch = cleanedAddress.match(numberRegex);
        if (numberMatch && numberMatch.index !== undefined) {
          earliestIndex = numberMatch.index;
        }

        const addressIndicators = [
          'house', 'h#', 'flat', 'f#', 'plot', 'p#', 'street', 'st', 'st#', 'road', 'rd', 'gali', 'gali#', 'block', 'sector', 'phase', 'town', 'colony', 'near', 'opposite', 'opp', 'chak', 'p/o', 'po', 'tehsil', 'dist', 'district', 'ward', 'b#', 'shop', 'bazar', 'bazaar', 'mohalla', 'mohallah', 'dhoke', 'kili', 'mouza', 'pind', 'village', 'qila', 'basti',
          'مکان', 'گلی', 'روڈ', 'چوک', 'بلاک', 'چک', 'تحصیل', 'ضلع', 'ڈاکخانہ', 'نزد', 'محلہ', 'کالونی', 'ٹاؤن', 'فلیٹ', 'دکان', 'پلاٹ', 'وارڈ', 'ہاؤس', 'شاپ', 'کیفے', 'کالج', 'اسکول', 'مسجد', 'نزدیک', 'بزار', 'بازار', 'موضع', 'پنڈ', 'بستی', 'قلعہ'
        ];

        for (const ind of addressIndicators) {
          const regex = getBoundarySafeRegex(ind);
          const match = cleanedAddress.match(regex);
          if (match && match.index !== undefined) {
            const capturedWord = match[1];
            const actualIndex = match[0].indexOf(capturedWord) + match.index;
            if (earliestIndex === -1 || actualIndex < earliestIndex) {
              earliestIndex = actualIndex;
            }
          }
        }

        if (earliestIndex > 2) {
          let possibleName = cleanedAddress.substring(0, earliestIndex).trim();
          possibleName = possibleName.replace(/^[\s,;\-\:۔\.\/]+|[\s,;\-\:۔\.\/]+$/g, '').trim();
          if (possibleName.length > 2 && !/\d/.test(possibleName) && possibleName.split(/\s+/).length <= 5) {
            extractedName = possibleName;
            cleanedAddress = cleanedAddress.substring(earliestIndex).trim();
          }
        } else {
          // Line split fallback
          const lines = cleanedAddress.split(/[\n\r,]+/);
          if (lines.length > 1) {
            const firstLine = lines[0].trim();
            if (firstLine.length > 2 && firstLine.length < 25 && !/\d/.test(firstLine)) {
              let hasIndicator = false;
              for (const ind of addressIndicators) {
                const regex = getBoundarySafeRegex(ind);
                if (regex.test(firstLine)) {
                  hasIndicator = true;
                  break;
                }
              }
              if (!hasIndicator) {
                extractedName = firstLine;
                cleanedAddress = lines.slice(1).join(', ').trim();
              }
            }
          }
        }
      }
    }

    if (extractedName && /^[a-zA-Z\s]+$/.test(extractedName)) {
      extractedName = extractedName.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());
    }

    // 4. Clean up address
    cleanedAddress = cleanedAddress
      .replace(/(?:Address|پتہ|ایڈریس)\s*[:\-\.۔]*/gi, '')
      .replace(/(?:Phone|Ph|Mob|Mobile|نمبر|فون|موبائل|Cell|City|شہر|CNIC|شناختی کارڈ|شناختی کارڈ نمبر)\s*[:\-\.۔]?\s*(?=\b|,|$)/gi, '')
      .replace(/[*&%$!^()\[\]{}"]/g, '')
      .replace(/[\n\r]+/g, ', ')
      .replace(/,+|،+/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();

    cleanedAddress = cleanedAddress.replace(/^[\s,]+|[\s,]+$/g, '');

    return {
      customerName: extractedName,
      customerPhone: extractedPhone,
      customerPhone2: extractedPhone2,
      customerCity: extractedCity,
      customerAddress: cleanedAddress
    };
  };

  const handleAddressChange = (e: any) => {
    const val = e.target.value;
    
    // Check if the pasted text looks like a WhatsApp/raw customer details block (contains a phone number or multiple lines)
    const hasPhone = /(?:03|\+?92\s*3)[0-9\-\s]{9,12}/.test(val);
    const hasMultipleLines = val.includes('\n') || val.includes('\r');
    
    if (hasPhone || hasMultipleLines) {
      const extracted = parseRawAddressDetails(val);
      setFormData(prev => ({
        ...prev,
        ...extracted,
        customerCNIC: prev.customerCNIC || generateCNICBasedOnAddress(extracted.customerAddress || val, extracted.customerCity || prev.customerCity)
      }));
      toast.success('معلومات خودکار طریقے سے نکال لی گئی ہیں!');
      return;
    }

    const update: any = { customerAddress: val };
    if (val.trim().length > 3 && !formData.customerCNIC) {
        update.customerCNIC = generateCNICBasedOnAddress(val, formData.customerCity);
    }
    setFormData({ ...formData, ...update });
  };

  const handleCityChange = (e: any) => {
    const val = e.target.value;
    const update: any = { customerCity: val };
    if (val.trim().length > 3 && !formData.customerCNIC) {
        update.customerCNIC = generateCNICBasedOnAddress(formData.customerAddress || '', val);
    }
    setFormData({ ...formData, ...update });
  };

  const addItem = (product: Product) => {
    setError(null);
    const existing = formData.items?.find(i => 
      i.productId === product.id || 
      normalizeUrduProductName(i.name) === normalizeUrduProductName(product.name)
    );
    if (existing) {
      setFormData({
        ...formData,
        items: formData.items?.map(i => i.productId === existing.productId ? { ...i, quantity: (i.quantity || 0) + 1 } : i)
      });
    } else {
      setFormData({
        ...formData,
        items: [...(formData.items || []), { 
          productId: product.id, 
          name: product.name, 
          quantity: 1, 
          price: product.sellingPrice || 0,
          cost: product.costPrice || 0
        }]
      });
    }
  };

  const updateItemPrice = (productId: string, price: number) => {
    setFormData({
      ...formData,
      items: formData.items?.map(i => i.productId === productId ? { ...i, price: price || 0 } : i)
    });
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    setFormData({
      ...formData,
      items: formData.items?.map(i => i.productId === productId ? { ...i, quantity: quantity || 0 } : i)
    });
  };

  const removeItem = (productId: string) => {
    setFormData({
      ...formData,
      items: formData.items?.filter(i => i.productId !== productId)
    });
  };

  const totalAmount = formData.items?.reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 0)), 0) || 0;
  const grossProfit = formData.items?.reduce((sum, i) => sum + (((i.price || 0) - (i.cost || 0)) * (i.quantity || 0)), 0) || 0;
  const totalProfit = grossProfit - (formData.deliveryCharges || 0);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!formData.items?.length) return setError('Add at least one product to the order');

    setIsSubmitting(true);
    setError(null);

    const orderData: any = {
      customerName: formData.customerName || '',
      customerPhone: formData.customerPhone || '',
      customerPhone2: formData.customerPhone2 || '',
      customerAddress: formData.customerAddress || '',
      customerCNIC: formData.customerCNIC || '',
      customerCity: formData.customerCity || '',
      items: formData.items || [],
      status: formData.status || 'Pending',
      labelType: formData.labelType || 'VPL',
      carrier: formData.carrier || 'Pakistan Post',
      trackingNumber: formData.trackingNumber || '',
      deliveryCharges: formData.deliveryCharges || 0,
      partnerName: formData.partnerName || '',
      partnerProfitAmount: formData.partnerProfitAmount || 0,
      totalAmount: formData.labelType === 'PAR' ? 0 : (isNaN(totalAmount) ? 0 : totalAmount),
      totalProfit: isNaN(totalProfit) ? 0 : totalProfit,
      paymentReceived: existingOrder?.paymentReceived || false,
      partnerPaid: existingOrder?.partnerPaid || false,
      userId: existingOrder?.userId || auth.currentUser?.uid,
      createdAt: existingOrder?.createdAt || new Date().toISOString(),
    };

    try {
      const batch = writeBatch(db);
      
      if (existingOrder) {
        // Stock adjustments for editing
        for (const item of formData.items || []) {
           const previousItem = existingOrder.items?.find((i: any) => i.productId === item.productId);
           const previousQty = previousItem ? previousItem.quantity : 0;
           const newQty = item.quantity || 0;
           
           if (previousQty !== newQty) {
              const diff = newQty - previousQty;
              const product = products.find((p: Product) => p.id === item.productId);
              if (product) {
                 batch.update(doc(db, 'products', product.id), { stock: product.stock - diff });
              }
           }
        }
        
        // Items that were removed completely
        for (const prevItem of existingOrder.items || []) {
           if (!formData.items?.find((i: any) => i.productId === prevItem.productId)) {
              const product = products.find((p: Product) => p.id === prevItem.productId);
              if (product) {
                 batch.update(doc(db, 'products', product.id), { stock: product.stock + (prevItem.quantity || 0) });
              }
           }
        }

        const orderRef = doc(db, 'orders', existingOrder.id);
        batch.update(orderRef, orderData);
      } else {
        // Reduce Stock for new order
        for (const item of formData.items || []) {
          const product = products.find((p: Product) => p.id === item.productId);
          if (product) {
            const productRef = doc(db, 'products', product.id);
            batch.update(productRef, { stock: product.stock - (item.quantity || 0) });
          }
        }

        const orderRef = doc(collection(db, 'orders'));
        batch.set(orderRef, orderData);
      }
      
      await batch.commit();
      onClose();
    } catch (error: any) {
      console.error('Error creating/updating order:', error);
      setIsSubmitting(false);
      setError(error.message || 'Failed to save order. Please check your connection and try again.');
      handleFirestoreError(error, existingOrder ? OperationType.UPDATE : OperationType.CREATE, 'orders');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">{existingOrder ? 'آرڈر میں ترمیم کریں' : 'نیا آرڈر بنائیں'}</h3>
            {error && <p className="text-xs text-red-500 font-medium mt-1">{error}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid md:grid-cols-2 gap-6 sm:gap-8">
          <div className="space-y-6 min-w-0">
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-900 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-indigo-600" />
                  گاہک کی تفصیلات (Customer)
                </h4>
                {/* Mode Selector Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setInputMode('voice')}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                      inputMode === 'voice' 
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-black/5 font-black' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5 text-indigo-600" />
                    <span>وائس نوٹ 🎙️</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('text')}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                      inputMode === 'text' 
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-black/5 font-black' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>واٹس ایپ ٹیکسٹ</span>
                  </button>
                </div>
              </div>

              <div className="grid gap-4">
                {/* Voice Note Recorder Mode */}
                {inputMode === 'voice' && (
                  <VoiceAddressRecorder
                    onApply={handleApplyVoiceData}
                    availableProducts={products}
                  />
                )}

                {/* WhatsApp Raw Text Paste Mode */}
                {inputMode === 'text' && (
                  <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-dashed border-indigo-200 space-y-2.5">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <Label className="text-indigo-950 font-bold text-xs flex items-center gap-1.5 mb-0">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                        واٹس ایپ سے کاپی شدہ مکمل تفصیلات یہاں پیسٹ کریں
                      </Label>
                      <div className="flex items-center gap-1.5">
                        <a
                          href="https://api.whatsapp.com/send"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            toast('واٹس ایپ کھل رہی ہے! گاہک کا میسج کاپی کر کے واپس آئیں 📲', { icon: '💬' });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer no-underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>واٹس ایپ کھولیں</span>
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            const clip = await readClipboardText();
                            if (clip) {
                              const extracted = parseRawAddressDetails(clip);
                              setFormData(prev => ({
                                ...prev,
                                ...extracted,
                                customerCNIC: prev.customerCNIC || generateCNICBasedOnAddress(extracted.customerAddress || clip, extracted.customerCity || prev.customerCity)
                              }));
                              toast.success('کلپ بورڈ سے معلومات خودکار درج ہو گئی ہیں! ✨');
                            } else {
                              toast('کلپ بورڈ خالی ہے یا اجازت نہیں ملی۔ نیچے باکس میں پیسٹ کریں۔', { icon: '📋' });
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                        >
                          <ClipboardPaste className="w-3 h-3" />
                          <span>کاپی شدہ پیسٹ کریں</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="مثال: نام علی، فون 03001234567، لاہور کینٹ"
                      className="w-full text-xs p-2.5 bg-white rounded-lg border border-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400 font-medium leading-relaxed"
                      onChange={(e: any) => {
                        const val = e.target.value;
                        if (!val.trim()) return;
                        const extracted = parseRawAddressDetails(val);
                        setFormData(prev => ({
                          ...prev,
                          ...extracted,
                          customerCNIC: prev.customerCNIC || generateCNICBasedOnAddress(extracted.customerAddress || val, extracted.customerCity || prev.customerCity)
                        }));
                        toast.success('معلومات خودکار طریقے سے درج ہو گئی ہیں!');
                      }}
                    />
                    <p className="text-[10px] text-indigo-600/80 font-medium">پیسٹ کرتے ہی نام، فون نمبر، شہر اور پتہ خود بخود الگ الگ خانوں میں بھر جائیں گے۔</p>
                  </div>
                )}
                {matchedPastOrder && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex flex-col gap-2.5 sm:gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-950 font-bold text-xs">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        پرانا گاہک مل گیا ہے! (Past Customer Found)
                      </div>
                      <div className="text-xs text-emerald-800 font-medium space-y-0.5">
                        <p>نام: <strong className="text-emerald-950">{matchedPastOrder.customerName}</strong> | شہر: <strong className="text-emerald-950">{matchedPastOrder.customerCity}</strong></p>
                        <p className="text-[11px] text-emerald-700/85 font-medium line-clamp-1">پتہ: {matchedPastOrder.customerAddress}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          customerName: matchedPastOrder.customerName || prev.customerName,
                          customerAddress: matchedPastOrder.customerAddress || prev.customerAddress,
                          customerCity: matchedPastOrder.customerCity || prev.customerCity,
                          customerPhone2: matchedPastOrder.customerPhone2 || prev.customerPhone2 || '',
                          customerCNIC: matchedPastOrder.customerCNIC || prev.customerCNIC || generateCNICBasedOnAddress(matchedPastOrder.customerAddress, matchedPastOrder.customerCity)
                        }));
                        toast.success('پرانے آرڈر سے گاہک کی تفصیلات خودکار طریقے سے درج کر دی گئیں!');
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs px-3 py-2 rounded-lg shadow-sm hover:shadow transition-all cursor-pointer text-center w-full"
                    >
                      پچھلی تفصیلات آٹو فل کریں ✨ (Autofill Past Details)
                    </button>
                  </div>
                )}
                <div>
                  <Label>گاہک کا نام</Label>
                  <Input required value={formData.customerName} onChange={(e: any) => setFormData({ ...formData, customerName: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>فون نمبر 1</Label>
                    <Input required value={formData.customerPhone} onChange={(e: any) => setFormData({ ...formData, customerPhone: e.target.value })} placeholder="03xx-xxxxxxx" />
                  </div>
                  <div>
                    <Label>فون نمبر 2 (بیک اپ)</Label>
                    <Input value={formData.customerPhone2 || ''} onChange={(e: any) => setFormData({ ...formData, customerPhone2: e.target.value })} placeholder="03xx-xxxxxxx" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>ڈیلیوری چارجز</Label>
                    <Input type="number" value={formData.deliveryCharges || 0} onChange={(e: any) => setFormData({ ...formData, deliveryCharges: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <Label>پارٹنر کا نام</Label>
                    <Input placeholder="مثلاً علی" value={formData.partnerName} onChange={(e: any) => setFormData({ ...formData, partnerName: e.target.value })} className="text-right" />
                    {partners.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 justify-start" dir="rtl">
                        {partners.map((pName: any) => (
                          <button
                            key={pName}
                            type="button"
                            onClick={() => setFormData({ ...formData, partnerName: pName })}
                            className={cn(
                              "px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer shadow-xs",
                              formData.partnerName === pName 
                                ? "bg-indigo-100 text-indigo-700 border-indigo-300 ring-2 ring-indigo-200"
                                : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200"
                            )}
                          >
                            ✓ {pName}
                          </button>
                        ))}
                        {formData.partnerName && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, partnerName: '' })}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 cursor-pointer shadow-xs"
                          >
                            صاف کریں (براہ راست)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label>پارٹنر کا منافع</Label>
                  <Input type="number" min="0" value={formData.partnerProfitAmount || 0} onChange={(e: any) => setFormData({ ...formData, partnerProfitAmount: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label className="mb-0">مکمل پتہ (Address)</Label>
                    <button 
                      type="button" 
                      onClick={optimizeAddress}
                      disabled={isOptimizing}
                      className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded transition-all disabled:opacity-50"
                    >
                      <Sparkles className={`w-3 h-3 ${isOptimizing ? 'animate-pulse' : ''}`} />
                      {isOptimizing ? 'درست ہو رہا ہے...' : 'پتہ درست کریں ✨'}
                    </button>
                  </div>
                  <Input required value={formData.customerAddress} onChange={handleAddressChange} />
                </div>
                <div>
                  <Label>شناختی کارڈ نمبر (CNIC)</Label>
                  <Input value={formData.customerCNIC || ''} onChange={(e: any) => setFormData({ ...formData, customerCNIC: e.target.value })} placeholder="مثلاً 4210112345671" />
                </div>
                <div>
                  <Label>شہر (City)</Label>
                  <Input required value={formData.customerCity} onChange={handleCityChange} />
                </div>
                <div>
                  <Label>کورئیر (Carrier)</Label>
                  <select 
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                    value={formData.carrier} 
                    onChange={(e: any) => {
                      const selectedCarrier = e.target.value as any;
                      setFormData(prev => ({
                        ...prev,
                        carrier: selectedCarrier,
                        labelType: selectedCarrier === "Pakistan Post" ? "VPL" : "COD"
                      }));
                    }}
                  >
                    <option value="Pakistan Post">Pakistan Post</option>
                    <option value="TCS">TCS</option>
                    <option value="Leopards">Leopards</option>
                  </select>
                </div>
                <div>
                  <Label>Tracking Number (Optional)</Label>
                  <div className="flex gap-2">
                    <Input value={formData.trackingNumber} onChange={(e: any) => setFormData({ ...formData, trackingNumber: e.target.value })} />
                    <Button type="button" variant="secondary" onClick={() => setFormData({ ...formData, trackingNumber: generateTrackingNumber() })}>
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Label Type</Label>
                  <select 
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={formData.labelType}
                    onChange={(e: any) => setFormData({ ...formData, labelType: e.target.value as LabelType })}
                  >
                    {(!formData.carrier || formData.carrier === 'Pakistan Post') ? (
                      <>
                        <option value="VPL">VPL (Value Payable Letter)</option>
                        <option value="VPP">VPP (Value Payable Parcel)</option>
                        <option value="PAR">PAR (Parcel Service - Non COD)</option>
                      </>
                    ) : (
                      <option value="COD">COD (Cash on Delivery)</option>
                    )}
                  </select>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6 min-w-0">
            <section className="space-y-4">
              <h4 className="font-bold text-gray-900 flex items-center justify-end gap-2 text-right">
                اشیاء (Order Items)
                <Package className="w-4 h-4 text-indigo-600" />
              </h4>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input 
                  placeholder="شامل کرنے کے لیے تلاش کریں..." 
                  className="pl-9 text-sm text-right"
                  value={productSearch}
                  onChange={(e: any) => setProductSearch(e.target.value)}
                />
              </div>

              <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg p-2 space-y-2 text-right">
                {uniqueModalProducts.map((p: Product) => (
                  <div key={p.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors">
                    <Button variant="ghost" className="p-1 h-auto" onClick={() => addItem(p)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-gray-500">{formatCurrency(p.sellingPrice)} • {p.stock} موجود</p>
                    </div>
                  </div>
                ))}
                {uniqueModalProducts.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">کوئی پروڈکٹ نہیں ملی</p>
                )}
              </div>

              <div className="space-y-2">
                {formData.items?.map(item => (
                  <div key={item.productId} className="bg-indigo-50 p-3 rounded-xl space-y-3 text-right">
                    <div className="flex items-center justify-between">
                      <button onClick={() => removeItem(item.productId)} className="text-indigo-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <p className="text-sm font-bold text-indigo-900">{item.name}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[10px] text-indigo-600 uppercase font-bold">تعداد</Label>
                        <Input 
                          type="number" 
                          className="h-8 text-xs bg-white text-center" 
                          value={item.quantity} 
                          onChange={(e: any) => updateItemQuantity(item.productId, parseInt(e.target.value))} 
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-indigo-600 uppercase font-bold">قیمت (Rs.)</Label>
                        <Input 
                          type="number" 
                          className="h-8 text-xs bg-white text-center" 
                          value={item.price} 
                          onChange={(e: any) => updateItemPrice(item.productId, parseFloat(e.target.value))} 
                        />
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-indigo-100">
                      <span className="text-sm font-bold text-indigo-900">{formatCurrency(item.price * item.quantity)}</span>
                      <span className="text-[10px] text-indigo-400 font-bold uppercase">کل</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-gray-100 text-right">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xl font-bold text-gray-900">{formatCurrency(totalAmount)}</span>
                  <span className="text-gray-500 font-bold">کل رقم</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-emerald-600">{formatCurrency(totalProfit)}</span>
                  <span className="text-gray-500 text-sm font-bold">متوقع منافع</span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isSubmitting}>کینسل</Button>
          <Button 
            className="flex-1" 
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                محفوظ ہو رہا ہے...
              </div>
            ) : (
              existingOrder ? 'آرڈر اپڈیٹ کریں' : 'آرڈر بنائیں'
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function OrderDetailModal({ order, settings, onClose, setCustomerFilter, setActiveTab, updateOrderStatus }: { order: Order, settings: Settings | null, onClose: () => void, setCustomerFilter: (f: string) => void, setActiveTab: (t: string) => void, updateOrderStatus: (id: string, s: OrderStatus) => Promise<void> }) {
  const [status, setStatus] = useState(order.status);
  const [previewTab, setPreviewTab] = useState<'label' | 'moneyOrder'>('label');
  const [moneyOrderDataOnly, setMoneyOrderDataOnly] = useState(false);
  const [topOffset, setTopOffset] = useState(0);
  const [leftOffset, setLeftOffset] = useState(0);
  const labelRef = useRef<HTMLDivElement>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, 'orders', order.id));
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `orders/${order.id}`);
    }
  };

  const handleStatusChange = async (newStatus: OrderStatus) => {
    setStatus(newStatus);
    await updateOrderStatus(order.id, newStatus);
  };

  const generatePDF = async () => {
    if (!labelRef.current) return;
    try {
      const canvas = await safeHtml2Canvas(labelRef.current, { 
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true
      });
      const imgData = canvas.toDataURL('image/png', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const imgProps = (pdf as any).getImageProperties(imgData);
      const pdfWidth = 100; // Larger single label
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth, pdfHeight);
      pdf.save(`Label_${order.trackingNumber}.pdf`);
      canvas.width = 0;
      canvas.height = 0;
    } catch (err) {
      console.error('Label PDF generation failed:', err);
      alert('لیبل ڈاؤن لوڈ نہیں ہو سکا۔ براہ کرم دوبارہ کوشش کریں۔');
    }
  };

  const generateMoneyOrderPDF = async () => {
    const splitAmounts = splitMoneyOrderAmounts(order.totalAmount || 0);
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '210mm';
    container.style.height = '297mm';
    container.style.backgroundColor = '#ffffff';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-9999';
    document.body.appendChild(container);

    const rootDiv = document.createElement('div');
    rootDiv.style.width = '210mm';
    rootDiv.style.height = '297mm';
    rootDiv.style.backgroundColor = '#ffffff';
    container.appendChild(rootDiv);
    const root = createRoot(rootDiv);

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      for (let i = 0; i < splitAmounts.length; i++) {
        if (i > 0) {
          pdf.addPage('a4', 'portrait');
        }
        const partAmount = splitAmounts[i];

        await new Promise<void>((resolve) => {
          root.render(
            <MoneyOrderCalibrator 
              order={order} 
              settings={settings} 
              dataOnly={moneyOrderDataOnly} 
              topOffset={topOffset} 
              leftOffset={leftOffset} 
              isCalibrating={false}
              customAmount={partAmount}
              partIndex={i + 1}
              totalParts={splitAmounts.length}
            />
          );
          setTimeout(resolve, 500);
        });

        const targetEl = (rootDiv.firstElementChild as HTMLElement) || rootDiv;
        const canvas = await safeHtml2Canvas(targetEl, { 
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        });
        const imgData = canvas.toDataURL('image/png', 0.95);
        pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
        canvas.width = 0;
        canvas.height = 0;
      }

      pdf.save(`MoneyOrder_${order.trackingNumber}${moneyOrderDataOnly ? '_DataOnly' : ''}.pdf`);
    } catch (error) {
      console.error('Money Order generation failed:', error);
      alert('منی آرڈر ڈاؤن لوڈ نہیں ہو سکا۔ براہ کرم دوبارہ کوشش کریں۔');
    } finally {
      root.unmount();
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">آرڈر کی تفصیلات (Order Details)</h3>
            <p className="text-sm text-gray-500">آئی ڈی: {order.id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid md:grid-cols-2 gap-6 sm:gap-8">
          <div className="space-y-6 min-w-0">
            <section className="space-y-4">
              <h4 className="font-bold text-gray-900">آرڈر کی تفصیلات (Order Details)</h4>
              <div className="bg-gray-50 p-4 rounded-xl space-y-2">
                <p className="text-sm"><span className="text-gray-500">Tracking:</span> <span className="font-mono font-bold">{order.trackingNumber}</span></p>
                {order.lastTrackingEvent && (
                  <p className="text-sm"><span className="text-gray-500">Current Status:</span> <span className="font-bold text-orange-600">{order.lastTrackingLocation} — {order.lastTrackingEvent}</span></p>
                )}
                <p className="text-sm"><span className="text-gray-500">Partner:</span> <span className="font-bold">{order.partnerName || 'Direct Sales'}</span></p>
                {order.partnerName && <p className="text-sm"><span className="text-gray-500">Partner Profit:</span> <span className="font-bold">{formatCurrency(order.partnerProfitAmount || 0)}</span></p>}
                <p className="text-sm"><span className="text-gray-500">Delivery Charges:</span> <span className="font-bold">{formatCurrency(order.deliveryCharges || 0)}</span></p>
                <p className="text-sm"><span className="text-gray-500">Total Amount:</span> <span className="font-bold text-indigo-600">{formatCurrency(order.totalAmount)}</span></p>
              </div>
            </section>

            <section className="space-y-4">
              <h4 className="font-bold text-gray-900">گاہک کی معلومات (Customer Info)</h4>
              <div className="bg-gray-50 p-4 rounded-xl space-y-2">
                <p className="text-sm"><span className="text-gray-500">Name:</span> {order.customerName}</p>
                <p className="text-sm"><span className="text-gray-500">Phone 1:</span> {order.customerPhone}</p>
                {order.customerPhone2 && (
                  <p className="text-sm"><span className="text-gray-500">Phone 2 (بیک اپ):</span> {order.customerPhone2}</p>
                )}
                <p className="text-sm"><span className="text-gray-500">Address:</span> {order.customerAddress}</p>
                <p className="text-sm"><span className="text-gray-500">City:</span> {order.customerCity}</p>
              </div>
            </section>

            <section className="space-y-4">
              <h4 className="font-bold text-gray-900 text-right">آرڈر کا اسٹیٹس (Order Status)</h4>
              <div className="grid grid-cols-2 gap-2" dir="rtl">
                {([
                  { key: 'Pending', label: 'زیر التواء' },
                  { key: 'Packed', label: 'پیک ہو گیا' },
                  { key: 'Shipped', label: 'روانہ کر دیا' },
                  { key: 'Delivered', label: 'پہنچ گیا' },
                  { key: 'Returned', label: 'واپس آ گیا' },
                  { key: 'Cancelled', label: 'کینسل ہو گیا' }
                ] as { key: OrderStatus, label: string }[]).map(s => (
                  <button
                    key={s.key}
                    onClick={() => handleStatusChange(s.key)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium border transition-all',
                      status === s.key 
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' 
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <h4 className="font-bold text-gray-900 text-right">آپشنز (Actions)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" dir="rtl">
                <Button variant="secondary" className="gap-2 justify-between w-full" onClick={() => {
                  const msg = generateCustomerMessage(order);
                  window.open(getWhatsAppLink(order.customerPhone, msg), '_blank');
                }}>
                  <MessageSquare className="w-4 h-4" />
                  واٹس ایپ اسٹیٹس اپڈیٹ {order.customerPhone2 ? '(1)' : ''}
                </Button>
                {order.customerPhone2 && (
                  <Button variant="secondary" className="gap-2 justify-between w-full" onClick={() => {
                    const msg = generateCustomerMessage(order);
                    window.open(getWhatsAppLink(order.customerPhone2, msg), '_blank');
                  }}>
                    <MessageSquare className="w-4 h-4" />
                    واٹس ایپ اسٹیٹس اپڈیٹ (2)
                  </Button>
                )}
                <Button variant="secondary" className="gap-2 justify-between w-full" onClick={() => {
                  const msg = generateCustomerMessage(order);
                  window.open(getWhatsAppLink(order.customerPhone, msg), '_blank');
                }}>
                  <Truck className="w-4 h-4" />
                  ٹریکنگ معلومات {order.customerPhone2 ? '(1)' : ''}
                </Button>
                {order.customerPhone2 && (
                  <Button variant="secondary" className="gap-2 justify-between w-full" onClick={() => {
                    const msg = generateCustomerMessage(order);
                    window.open(getWhatsAppLink(order.customerPhone2, msg), '_blank');
                  }}>
                    <Truck className="w-4 h-4" />
                    ٹریکنگ معلومات (2)
                  </Button>
                )}
                <Button variant="secondary" className="gap-2 justify-between w-full" onClick={() => { setCustomerFilter(order.customerPhone); setActiveTab('orders'); onClose(); }}>
                  <QrCode className="w-4 h-4" />
                  آرڈر ہسٹری
                </Button>
                <Button variant="secondary" className="gap-2 justify-between w-full" onClick={generatePDF}>
                  <Download className="w-4 h-4" />
                  لیبل (PDF)
                </Button>
                {(!order.carrier || order.carrier === 'Pakistan Post') && (
                  <Button variant="secondary" className="gap-2 justify-between w-full" onClick={generateMoneyOrderPDF}>
                    <Download className="w-4 h-4 text-emerald-600" />
                    {moneyOrderDataOnly ? 'منی آرڈر (صرف ڈیٹا PDF)' : 'منی آرڈر (مکمل فارم PDF)'}
                  </Button>
                )}
                <Button variant="danger" className="gap-2 justify-between w-full" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="w-4 h-4" />
                  ڈیلیٹ کریں
                </Button>
              </div>
            </section>
          </div>

          <div className="space-y-4 min-w-0">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h4 className="font-bold text-gray-900">پرنٹ پرویو (Print Preview)</h4>
              <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold gap-1">
                <button 
                  onClick={() => setPreviewTab('label')} 
                  className={cn("px-3 py-1.5 rounded-md transition-all", previewTab === 'label' ? "bg-white shadow text-indigo-700 font-bold" : "text-gray-600 hover:text-gray-900")}
                >
                  شپنگ لیبل
                </button>
                {(!order.carrier || order.carrier === 'Pakistan Post') && (
                  <button 
                    onClick={() => setPreviewTab('moneyOrder')} 
                    className={cn("px-3 py-1.5 rounded-md transition-all", previewTab === 'moneyOrder' ? "bg-white shadow text-emerald-700 font-bold" : "text-gray-600 hover:text-gray-900")}
                  >
                    منی آرڈر فارم
                  </button>
                )}
              </div>
            </div>

            {previewTab === 'moneyOrder' && (
              <div className="flex flex-col gap-2 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-xs" dir="rtl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 flex items-center gap-1">
                    🎯 پرنٹ موڈ (Print Mode):
                  </span>
                  <div className="flex bg-white p-1 rounded-lg border border-emerald-200 gap-1 font-bold">
                    <button
                      type="button"
                      onClick={() => setMoneyOrderDataOnly(false)}
                      className={cn("px-2.5 py-1 rounded-md transition-all cursor-pointer", !moneyOrderDataOnly ? "bg-emerald-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900")}
                    >
                      📄 مکمل فارم
                    </button>
                    <button
                      type="button"
                      onClick={() => setMoneyOrderDataOnly(true)}
                      className={cn("px-2.5 py-1 rounded-md transition-all cursor-pointer", moneyOrderDataOnly ? "bg-amber-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900")}
                    >
                      🎯 صرف ڈیٹا (پری پرنٹڈ پیپر)
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-emerald-200/60 text-gray-700">
                  <span className="font-semibold text-emerald-950">📐 پرنٹر الائنمنٹ (Alignment Shift):</span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span>اوپر/نیچے (Top):</span>
                      <button 
                        type="button" 
                        onClick={() => setTopOffset(t => t - 1)}
                        className="w-5 h-5 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold flex items-center justify-center text-xs"
                      >-</button>
                      <span className="w-8 text-center font-bold text-indigo-700">{topOffset}mm</span>
                      <button 
                        type="button" 
                        onClick={() => setTopOffset(t => t + 1)}
                        className="w-5 h-5 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold flex items-center justify-center text-xs"
                      >+</button>
                    </div>

                    <div className="flex items-center gap-1">
                      <span>دائیں/بائیں (Left):</span>
                      <button 
                        type="button" 
                        onClick={() => setLeftOffset(l => l - 1)}
                        className="w-5 h-5 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold flex items-center justify-center text-xs"
                      >-</button>
                      <span className="w-8 text-center font-bold text-indigo-700">{leftOffset}mm</span>
                      <button 
                        type="button" 
                        onClick={() => setLeftOffset(l => l + 1)}
                        className="w-5 h-5 bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold flex items-center justify-center text-xs"
                      >+</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="border border-dashed border-gray-300 rounded-xl p-1.5 sm:p-3 bg-gray-50 flex justify-center w-full overflow-x-auto max-h-[600px] overflow-y-auto">
              {previewTab === 'label' ? (
                <ShippingLabel order={order} settings={settings} labelRef={labelRef} />
              ) : (
                <div className="w-full my-1 flex justify-center">
                  <MoneyOrderCalibrator order={order} settings={settings} dataOnly={moneyOrderDataOnly} topOffset={topOffset} leftOffset={leftOffset} isCalibrating={true} />
                </div>
              )}
            </div>
          </div>
        </div>
        <AnimatePresence>
          {showDeleteConfirm && (
            <ConfirmationModal
              title="Delete Order"
              message="Are you sure you want to delete this order? This action cannot be undone."
              onConfirm={handleDelete}
              onCancel={() => setShowDeleteConfirm(false)}
              confirmText="Delete"
              variant="danger"
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function ConfirmationModal({ title, message, onConfirm, onCancel, confirmText = 'تصدیق کریں', variant = 'primary' }: { title: string, message: string, onConfirm: () => void, onCancel: () => void, confirmText?: string, variant?: 'primary' | 'danger' }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl text-right"
        dir="rtl"
      >
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-sm text-gray-500">{message}</p>
        </div>
        <div className="p-4 bg-gray-50 flex gap-3">
          <Button variant="secondary" className="flex-1 font-bold" onClick={onCancel}>کینسل</Button>
          <Button variant={variant} className="flex-1 font-bold" onClick={onConfirm}>{confirmText}</Button>
        </div>
      </motion.div>
    </div>
  );
}

function SyncReportModal({ reports, onClose }: { reports: Record<string, any>; onClose: () => void }) {
  const list = Object.values(reports);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[200]">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-right"
        dir="rtl"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
          <div className="text-right">
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2 justify-end">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              لائیو ٹریکنگ اپڈیٹ رپورٹ / Sync Session Report
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              اس سیشن میں کل {list.length} آرڈرز کی ٹریکنگ تفصیلات یا اسٹیٹس اپڈیٹ ہوئے ہیں۔
            </p>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          <div className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right text-gray-700">
                <thead className="bg-gray-50 text-[11px] sm:text-xs text-gray-500 uppercase font-bold tracking-wider border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-right">آرڈر / کسٹمر</th>
                    <th className="px-4 py-3 text-right">ٹریکنگ ID</th>
                    <th className="px-4 py-3 text-center">پرانا اسٹیٹس</th>
                    <th className="px-4 py-3 text-center">نیا اسٹیٹس</th>
                    <th className="px-4 py-3 text-right">تازہ ترین معلومات (Event Description)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.map((item: any, idx) => {
                    const statusChanged = item.oldStatus !== item.newStatus;
                    const eventChanged = item.oldEvent !== item.newEvent;
                    return (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-4.5">
                          <p className="font-bold text-gray-900">{item.customerName}</p>
                        </td>
                        <td className="px-4 py-4.5 font-mono text-xs font-semibold text-gray-600">
                          {item.trackingNumber}
                        </td>
                        <td className="px-4 py-4.5 text-center">
                          <Badge status={item.oldStatus}>{item.oldStatus}</Badge>
                        </td>
                        <td className="px-4 py-4.5 text-center">
                          {statusChanged ? (
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-xs text-gray-400">→</span>
                              <Badge status={item.newStatus}>{item.newStatus}</Badge>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 font-medium">کوئی تبدیلی نہیں</span>
                          )}
                        </td>
                        <td className="px-4 py-4.5 text-right font-medium max-w-[255px]">
                          <p className="text-xs text-gray-800 break-words">{item.newEvent}</p>
                          {eventChanged && item.oldEvent && item.oldEvent !== "کوئی معلومات نہیں" && (
                            <p className="text-[10px] text-gray-400 line-through mt-0.5 break-words">
                              پہلے: {item.oldEvent}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <Button onClick={onClose} className="px-6 font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md">
            بند کریں / Close
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ==========================================================
// --- BulkMessageModal Component ---
// ==========================================================
function BulkMessageModal({ 
  orders, 
  settings, 
  onClose,
  onRecordResult,
  onOpenInspector,
  whatsappLogsCount = 0
}: { 
  orders: Order[]; 
  settings: Settings | null; 
  onClose: () => void;
  onRecordResult?: (result: MetaSendResult) => void;
  onOpenInspector?: () => void;
  whatsappLogsCount?: number;
}) {
  const [activeTab, setActiveTab] = useState<'sms' | 'whatsapp' | 'api'>('sms');
  const [templateType, setTemplateType] = useState<'dispatch' | 'confirm' | 'payment' | 'custom'>('dispatch');
  const [customTemplate, setCustomTemplate] = useState(
    'محترم {customerName}! آپ کا پارسل {carrier} کے ذریعے ڈسپیچ کر دیا گیا ہے۔ ٹریکنگ نمبر: {trackingNumber}۔ کل رقم: Rs {totalAmount}۔ شکریہ!'
  );
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const defaultTemplates = {
    dispatch: 'محترم {customerName}! آپ کا پارسل {carrier} کے ذریعے ڈسپیچ کر دیا گیا ہے۔ ٹریکنگ نمبر: {trackingNumber}۔ کل رقم: Rs {totalAmount}۔ شکریہ!',
    confirm: 'محترم {customerName}! آپ کا آرڈر (ٹوٹل رقم: Rs {totalAmount}) موصول ہو گیا ہے۔ جلد آپ کو ڈسپیچ کر دیا جائے گا۔ شکریہ!',
    payment: 'سلام {customerName}! آپ کے آرڈر (ٹریکنگ #{trackingNumber}) کی رقم Rs {totalAmount} واجب الادا ہے۔ براہ کرم وصولی یقینی بنائیں۔ شکریہ!',
    custom: customTemplate
  };

  const getTemplateText = () => {
    if (templateType === 'custom') return customTemplate;
    return defaultTemplates[templateType];
  };

  const renderMessageForOrder = (order: Order, templateStr: string) => {
    let msg = templateStr;
    msg = msg.replace(/\{customerName\}/g, order.customerName || 'گاہک');
    msg = msg.replace(/\{trackingNumber\}/g, order.trackingNumber || '');
    msg = msg.replace(/\{totalAmount\}/g, (order.totalAmount || 0).toLocaleString());
    msg = msg.replace(/\{status\}/g, order.status || '');
    msg = msg.replace(/\{carrier\}/g, order.carrier || 'Pakistan Post');
    return msg;
  };

  const validPhoneNumbers = useMemo(() => {
    return orders
      .map(o => o.customerPhone)
      .filter(p => p && p.trim().length >= 10)
      .map(p => p.trim().replace(/[^0-9+]/g, ''));
  }, [orders]);

  const handleOpenNativeSms = () => {
    if (validPhoneNumbers.length === 0) {
      alert('کوئی جائز فون نمبر نہیں ملا۔');
      return;
    }
    const sampleMsg = renderMessageForOrder(orders[0] || {} as Order, getTemplateText());
    const joinedNumbers = validPhoneNumbers.join(',');
    const encodedBody = encodeURIComponent(sampleMsg);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const smsUrl = `sms:${joinedNumbers}${isIOS ? '&' : '?'}body=${encodedBody}`;
    window.location.href = smsUrl;
  };

  const handleCopyNumbers = () => {
    if (validPhoneNumbers.length === 0) {
      alert('کوئی جائز فون نمبر نہیں ملا۔');
      return;
    }
    const textToCopy = validPhoneNumbers.join(', ');
    navigator.clipboard.writeText(textToCopy);
    setCopyStatus('نمبرز کاپی ہو گئے!');
    setTimeout(() => setCopyStatus(null), 3000);
  };

  const handleCopyText = () => {
    const textToCopy = getTemplateText();
    navigator.clipboard.writeText(textToCopy);
    setCopyStatus('متن کاپی ہو گیا!');
    setTimeout(() => setCopyStatus(null), 3000);
  };

  const handleSendAutoWhatsApp = async () => {
    const provider = settings?.whatsappProvider || (settings?.metaPhoneNumberId && settings?.metaAccessToken ? 'meta' : (settings?.ultraMsgInstanceId ? 'ultramsg' : 'manual'));

    if (provider === 'meta' && (!settings?.metaPhoneNumberId || !settings?.metaAccessToken)) {
      alert('Meta WhatsApp Cloud API کی سیٹنگز ناقص ہیں۔ براہ کرم پہلے سیٹنگز میں Phone Number ID اور Permanent Access Token درج کریں۔');
      return;
    }

    if (provider === 'ultramsg' && (!settings?.ultraMsgInstanceId || !settings?.ultraMsgToken)) {
      alert('UltraMsg کی سیٹنگز موجود نہیں ہیں۔ براہ کرم پہلے سیٹنگز میں Instance ID اور Token درج کریں۔');
      return;
    }

    if (provider === 'manual') {
      alert('کوئی WhatsApp API کنفیگر نہیں ہے۔ براہ کرم پہلے سیٹنگز میں Meta Cloud API یا UltraMsg کی تفصیلات درج کریں یا دستی واٹس ایپ لنکس کا استعمال کریں۔');
      return;
    }

    const providerLabel = provider === 'meta' ? 'Meta WhatsApp Cloud API' : 'UltraMsg API';
    if (!confirm(`کیا آپ واقعی ${providerLabel} کے ذریعے ${orders.length} گاہکوں کو خودکار واٹس ایپ میسیجز بھیجنا چاہتے ہیں؟`)) return;

    setIsSending(true);
    let successCount = 0;
    let failCount = 0;
    let lastErrorAdvice = '';
    const template = getTemplateText();

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      setSendProgress(Math.round(((i + 1) / orders.length) * 100));
      setStatusMsg(`${order.customerName} کو بھیجا جا رہا ہے (${i + 1}/${orders.length})...`);

      const msgText = renderMessageForOrder(order, template);
      const phone = order.customerPhone.replace(/[^0-9]/g, '');
      const formattedPhone = phone.startsWith('03') ? '92' + phone.slice(1) : phone;

      try {
        if (provider === 'meta') {
          const result = await sendMetaWhatsAppMessage({
            phoneNumberId: settings?.metaPhoneNumberId || '',
            accessToken: settings?.metaAccessToken || '',
            recipientPhone: order.customerPhone,
            messageText: msgText,
            messageType: settings?.metaMessageType || 'auto',
            templateName: settings?.metaTemplateName || 'hello_world',
            templateLanguage: settings?.metaTemplateLanguage || 'en_US',
          });

          if (onRecordResult) onRecordResult(result);

          if (result.success) {
            successCount++;
          } else {
            failCount++;
            lastErrorAdvice = result.urduAdvice || result.errorMessage || 'Meta API call failed';
            console.error('Meta Cloud API error for order:', order.id, result);
          }
        } else if (provider === 'ultramsg') {
          const response = await fetch(`https://api.ultramsg.com/${settings?.ultraMsgInstanceId}/messages/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: settings?.ultraMsgToken || '',
              to: formattedPhone,
              body: msgText
            })
          });
          const resData = await response.json();
          if (resData.sent === 'true' || resData.id) {
            successCount++;
          } else {
            failCount++;
          }
        }
      } catch (err) {
        failCount++;
        console.error('WhatsApp send error:', err);
      }

      await new Promise(r => setTimeout(r, 600));
    }

    setIsSending(false);
    setStatusMsg('');
    if (failCount === 0) {
      toast.success(`${successCount} / ${orders.length} واٹس ایپ میسیجز کامیابی سے بھیجے گئے! 🎉`);
    } else {
      if (onOpenInspector) onOpenInspector();
      toast.error(`${successCount} کامیاب، ${failCount} ناکام۔ تفصیلی لائیو لاگز کھل گئے ہیں۔`, { duration: 8000 });
    }
  };

  const handleOpenWhatsAppTabs = () => {
    const template = getTemplateText();
    orders.forEach((order, index) => {
      setTimeout(() => {
        const msg = renderMessageForOrder(order, template);
        const phone = order.customerPhone.replace(/[^0-9]/g, '');
        const formattedPhone = phone.startsWith('03') ? '92' + phone.slice(1) : phone;
        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      }, index * 400);
    });
  };

  const handleSendSmsGatewayApi = async () => {
    if (!settings?.smsGatewayUrl) {
      alert('سیٹنگز میں SMS Gateway URL موجود نہیں ہے۔');
      return;
    }

    if (!confirm(`کیا آپ SMS Gateway API کے ذریعے ${orders.length} گاہکوں کو SMS بھیجنا چاہتے ہیں؟`)) return;

    setIsSending(true);
    let successCount = 0;
    const template = getTemplateText();

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      setSendProgress(Math.round(((i + 1) / orders.length) * 100));
      setStatusMsg(`${order.customerName} کو SMS بھیجا جا رہا ہے (${i + 1}/${orders.length})...`);

      const msgText = renderMessageForOrder(order, template);
      const phone = order.customerPhone.replace(/[^0-9]/g, '');

      let apiUrl = settings.smsGatewayUrl
        .replace(/\{phone\}/g, encodeURIComponent(phone))
        .replace(/\{message\}/g, encodeURIComponent(msgText));

      try {
        await fetch(apiUrl, { method: 'GET', mode: 'no-cors' });
        successCount++;
      } catch (err) {
        console.error('SMS Gateway API error:', err);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    setIsSending(false);
    setStatusMsg('');
    alert(`SMS API ریکویسٹ مکمل ہو گئی!`);
  };

  // State for No-API Sequential Runner
  const [runnerIndex, setRunnerIndex] = useState(0);
  const [sentSet, setSentSet] = useState<Set<string>>(new Set());
  const [autoAdvance, setAutoAdvance] = useState(true);

  const currentRunnerOrder = orders[runnerIndex] || orders[0];

  const handleNextRunner = () => {
    if (runnerIndex < orders.length - 1) {
      setRunnerIndex(runnerIndex + 1);
    }
  };

  const handlePrevRunner = () => {
    if (runnerIndex > 0) {
      setRunnerIndex(runnerIndex - 1);
    }
  };

  const handleSendRunnerSms = (order: Order) => {
    if (!order) return;
    const template = getTemplateText();
    const msg = renderMessageForOrder(order, template);
    const phone = order.customerPhone.replace(/[^0-9]/g, '');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const smsUrl = `sms:${phone}${isIOS ? '&' : '?'}body=${encodeURIComponent(msg)}`;
    
    setSentSet(prev => new Set(prev).add(order.id));
    window.location.href = smsUrl;

    if (autoAdvance && runnerIndex < orders.length - 1) {
      setTimeout(() => {
        setRunnerIndex(prev => prev + 1);
      }, 500);
    }
  };

  const handleSendRunnerWhatsApp = (order: Order) => {
    if (!order) return;
    const template = getTemplateText();
    const msg = renderMessageForOrder(order, template);
    const phone = order.customerPhone.replace(/[^0-9]/g, '');
    const formattedPhone = phone.startsWith('03') ? '92' + phone.slice(1) : phone;
    
    setSentSet(prev => new Set(prev).add(order.id));
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');

    if (autoAdvance && runnerIndex < orders.length - 1) {
      setTimeout(() => {
        setRunnerIndex(prev => prev + 1);
      }, 500);
    }
  };

  const handleDownloadBulkSmsCsv = () => {
    const template = getTemplateText();
    const rows = orders.map(o => {
      const phone = o.customerPhone.replace(/[^0-9]/g, '');
      const msg = renderMessageForOrder(o, template).replace(/"/g, '""');
      return `"${phone}","${o.customerName.replace(/"/g, '""')}","${msg}"`;
    });

    const csvContent = "\uFEFFPhone,Name,Message\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bulk_SMS_List_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto dir-rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-gray-100 my-8 text-right"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-indigo-700 p-5 text-white flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <MessageSquare className="w-6 h-6" />
              بلک میسجنگ و اطلاع دہندہ (Bulk Messaging Center)
            </h2>
            <p className="text-xs text-emerald-100 mt-1">
              منتخب گاہکوں کی تعداد: <span className="font-bold bg-white/20 px-2 py-0.5 rounded-full">{orders.length}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/20 text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Method Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-gray-100 p-1.5 rounded-xl text-center text-xs font-bold">
            <button
              onClick={() => setActiveTab('sms')}
              className={cn(
                "py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5",
                activeTab === 'sms' ? "bg-white text-emerald-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
              )}
            >
              📱 سادہ میسج (SIM SMS)
            </button>
            <button
              onClick={() => setActiveTab('whatsapp')}
              className={cn(
                "py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5",
                activeTab === 'whatsapp' ? "bg-white text-emerald-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
              )}
            >
              💬 واٹس ایپ (WhatsApp)
            </button>
            <button
              onClick={() => setActiveTab('api')}
              className={cn(
                "py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5",
                activeTab === 'api' ? "bg-white text-emerald-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
              )}
            >
              🌐 SMS API Gateway
            </button>
          </div>

          {/* Template Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-700 block">ٹیمپلیٹ منتخب کریں:</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => setTemplateType('dispatch')}
                className={cn(
                  "p-2 text-[11px] font-bold rounded-lg border text-center transition-all",
                  templateType === 'dispatch' ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                )}
              >
                🚚 ڈسپیچ و ٹریکنگ
              </button>
              <button
                onClick={() => setTemplateType('confirm')}
                className={cn(
                  "p-2 text-[11px] font-bold rounded-lg border text-center transition-all",
                  templateType === 'confirm' ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                )}
              >
                📦 آرڈر کی تصدیق
              </button>
              <button
                onClick={() => setTemplateType('payment')}
                className={cn(
                  "p-2 text-[11px] font-bold rounded-lg border text-center transition-all",
                  templateType === 'payment' ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                )}
              >
                💰 کیش آن ڈیلیوری
              </button>
              <button
                onClick={() => setTemplateType('custom')}
                className={cn(
                  "p-2 text-[11px] font-bold rounded-lg border text-center transition-all",
                  templateType === 'custom' ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                )}
              >
                ✏️ کسٹم پیغام
              </button>
            </div>

            {templateType === 'custom' && (
              <div className="mt-2">
                <textarea
                  value={customTemplate}
                  onChange={e => setCustomTemplate(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="اپنا کسٹم میسج یہاں لکھیں..."
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  ٹیگز استعمال کریں: <code className="bg-gray-100 px-1">{'{customerName}'}</code>, <code className="bg-gray-100 px-1">{'{trackingNumber}'}</code>, <code className="bg-gray-100 px-1">{'{totalAmount}'}</code>, <code className="bg-gray-100 px-1">{'{carrier}'}</code>
                </p>
              </div>
            )}
          </div>

          {/* Live Preview Box */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-amber-800 block">پہلے گاہک کے لیے تیار شدہ میسج (نمونہ):</span>
            <p className="text-xs text-gray-800 leading-relaxed font-sans bg-white p-2.5 rounded-lg border border-amber-100 shadow-sm">
              {orders.length > 0 ? renderMessageForOrder(orders[0], getTemplateText()) : 'کوئی آرڈر منتخب نہیں ہے۔'}
            </p>
          </div>

          {copyStatus && (
            <div className="bg-emerald-100 text-emerald-800 text-xs font-bold p-2 rounded-lg text-center animate-pulse">
              {copyStatus}
            </div>
          )}

          {/* Tab 1: SIM SMS Controls */}
          {activeTab === 'sms' && (
            <div className="space-y-5">
              {/* No-API Sequential Runner Panel */}
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50/60 p-4 rounded-xl border border-emerald-200 shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-emerald-200/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-xs">
                      گاہک {runnerIndex + 1} / {orders.length}
                    </span>
                    <h3 className="text-sm font-bold text-emerald-950">
                      بغیر API کے یکے بعد دیگرے میسج بھیجیں (Sequential Step-by-Step Runner)
                    </h3>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-emerald-900 cursor-pointer font-semibold">
                    <input 
                      type="checkbox" 
                      checked={autoAdvance} 
                      onChange={e => setAutoAdvance(e.target.checked)} 
                      className="rounded text-emerald-600 focus:ring-emerald-500" 
                    />
                    میسج بھیجنے پر اگلا گاہک آٹو لائیں
                  </label>
                </div>

                {currentRunnerOrder ? (
                  <div className="space-y-3">
                    {/* Customer Meta Details */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white p-3 rounded-lg border border-emerald-100 shadow-2xs">
                      <div>
                        <span className="text-gray-400 text-[10px] block">گاہک کا نام:</span>
                        <span className="font-bold text-gray-800">{currentRunnerOrder.customerName}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-[10px] block">فون نمبر:</span>
                        <span className="font-bold text-emerald-700 dir-ltr text-right">{currentRunnerOrder.customerPhone}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-[10px] block">ٹریکنگ نمبر:</span>
                        <span className="font-mono font-bold text-indigo-700">{currentRunnerOrder.trackingNumber || 'موجود نہیں'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-[10px] block">کل رقم:</span>
                        <span className="font-bold text-gray-900">Rs {(currentRunnerOrder.totalAmount || 0).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Rendered Message Card */}
                    <div className="bg-white p-3 rounded-lg border border-emerald-200 space-y-1">
                      <div className="flex justify-between items-center text-[10px] text-gray-500 font-bold">
                        <span>تیار شدہ کسٹم میسج:</span>
                        {sentSet.has(currentRunnerOrder.id) && (
                          <span className="text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> بھیجا جا چکا ہے
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-800 leading-relaxed font-sans bg-emerald-50/30 p-2.5 rounded border border-emerald-100">
                        {renderMessageForOrder(currentRunnerOrder, getTemplateText())}
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Button 
                        onClick={() => handleSendRunnerSms(currentRunnerOrder)} 
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 h-auto shadow-sm"
                      >
                        📱 SIM SMS بھیجیں
                      </Button>

                      <Button 
                        onClick={() => handleSendRunnerWhatsApp(currentRunnerOrder)} 
                        className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2.5 h-auto shadow-sm"
                      >
                        💬 واٹس ایپ بھیجیں
                      </Button>

                      <Button 
                        onClick={() => {
                          const msg = renderMessageForOrder(currentRunnerOrder, getTemplateText());
                          navigator.clipboard.writeText(msg);
                          setCopyStatus(`میسج کاپی ہو گیا! (${currentRunnerOrder.customerName})`);
                          setTimeout(() => setCopyStatus(null), 2500);
                        }} 
                        variant="outline" 
                        className="border-emerald-300 text-emerald-800 hover:bg-emerald-100 font-bold text-xs py-2.5 h-auto"
                      >
                        <Copy className="w-3.5 h-3.5 ml-1" /> کاپی کریں
                      </Button>

                      <div className="flex gap-1">
                        <Button 
                          onClick={handlePrevRunner} 
                          disabled={runnerIndex === 0} 
                          variant="secondary" 
                          className="w-1/2 py-2.5 h-auto text-xs font-bold"
                        >
                          پچھلا
                        </Button>
                        <Button 
                          onClick={handleNextRunner} 
                          disabled={runnerIndex === orders.length - 1} 
                          variant="secondary" 
                          className="w-1/2 py-2.5 h-auto text-xs font-bold"
                        >
                          اگلا ⏭️
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">کوئی آرڈر دستیاب نہیں ہے۔</p>
                )}

                {/* Overall Progress Bar */}
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[11px] font-bold text-emerald-900">
                    <span>بھیجنے کی پیشرفت:</span>
                    <span>{sentSet.size} / {orders.length} مکمل ({Math.round((sentSet.size / orders.length) * 100)}%)</span>
                  </div>
                  <div className="w-full bg-emerald-200/60 rounded-full h-2">
                    <div 
                      className="bg-emerald-600 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${(sentSet.size / orders.length) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Utility Bulk Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <Button 
                  onClick={handleOpenNativeSms} 
                  variant="outline"
                  className="w-full border-gray-300 text-gray-700 hover:bg-gray-100 font-bold text-xs py-2.5 h-auto"
                >
                  <MessageSquare className="w-4 h-4 ml-1.5 text-emerald-600" />
                  موبائل کی SIM SMS ایپ میں تمام نمبرز کھولیں ({validPhoneNumbers.length})
                </Button>

                <Button 
                  onClick={handleDownloadBulkSmsCsv} 
                  variant="outline"
                  className="w-full border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 font-bold text-xs py-2.5 h-auto"
                >
                  <Download className="w-4 h-4 ml-1.5 text-indigo-600" />
                  اینڈرائیڈ بلک SMS ایپس کے لیے CSV ایکسپورٹ کریں
                </Button>
              </div>

              {/* All Orders Table with 1-Click Send */}
              <div className="space-y-2 border-t border-gray-100 pt-4">
                <h4 className="text-xs font-bold text-gray-800 flex justify-between items-center">
                  <span>تمام گاہکوں کا میسج ٹیبل (بغیر API کے ون کلک بھیجیں):</span>
                  <span className="text-[10px] text-gray-500 font-normal">کل: {orders.length} گاہک</span>
                </h4>

                <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
                  {orders.map((order, idx) => {
                    const isSent = sentSet.has(order.id);
                    const msg = renderMessageForOrder(order, getTemplateText());
                    return (
                      <div key={order.id || idx} className={cn("p-2.5 flex items-center justify-between text-xs gap-3 transition-colors", isSent ? "bg-emerald-50/40" : "hover:bg-gray-50")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900">{order.customerName}</span>
                            <span className="text-[11px] text-emerald-700 dir-ltr">{order.customerPhone}</span>
                            {isSent && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full">
                                ✓ بھیج دیا
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-600 truncate mt-0.5">{msg}</p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => handleSendRunnerSms(order)}
                            className="bg-emerald-600 text-white p-1.5 rounded hover:bg-emerald-700 transition-colors title='SMS بھیجیں'"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleSendRunnerWhatsApp(order)}
                            className="bg-green-600 text-white p-1.5 rounded hover:bg-green-700 transition-colors title='واٹس ایپ بھیجیں'"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(msg);
                              setCopyStatus(`میسج کاپی ہو گیا! (${order.customerName})`);
                              setTimeout(() => setCopyStatus(null), 2500);
                            }}
                            className="bg-gray-100 text-gray-700 p-1.5 rounded hover:bg-gray-200 transition-colors title='کاپی کریں'"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: WhatsApp Controls */}
          {activeTab === 'whatsapp' && (
            <div className="space-y-4 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
              <div className="text-xs text-gray-700 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-emerald-900">💬 واٹس ایپ خودکار و دستی اوپشنز:</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    فعال API: {
                      settings?.whatsappProvider === 'meta' || (!settings?.whatsappProvider && settings?.metaPhoneNumberId) 
                        ? 'Meta Cloud API 🚀' 
                        : settings?.ultraMsgInstanceId 
                          ? 'UltraMsg API ⚡' 
                          : 'دستی لنکس 🌐'
                    }
                  </span>
                </div>
                <p>Meta WhatsApp Cloud API یا UltraMsg کے ذریعے بغیر واٹس ایپ کھولے ایک کلک پر تمام میسیجز بھیجیں۔</p>
              </div>

              {isSending && (
                <div className="space-y-2 bg-white p-3 rounded-lg border border-emerald-200">
                  <div className="flex justify-between text-xs font-bold text-emerald-800">
                    <span>{statusMsg}</span>
                    <span>{sendProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${sendProgress}%` }}></div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Button 
                  onClick={handleSendAutoWhatsApp} 
                  disabled={isSending}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 h-auto shadow-md"
                >
                  🚀 خودکار واٹس ایپ API ({orders.length})
                </Button>

                <Button 
                  onClick={handleOpenWhatsAppTabs} 
                  disabled={isSending}
                  variant="outline"
                  className="w-full border-emerald-600 text-emerald-800 hover:bg-emerald-100 font-bold text-xs py-2.5 h-auto"
                >
                  🌐 دستی واٹس ایپ ٹیبز کھولیں
                </Button>

                <Button 
                  onClick={onOpenInspector} 
                  variant="outline"
                  className="w-full bg-white border-emerald-300 text-emerald-950 hover:bg-emerald-50 font-bold text-xs py-2.5 h-auto"
                >
                  💻 میٹا لائیو لاگز و انسپیکٹر ({whatsappLogsCount})
                </Button>
              </div>
            </div>
          )}

          {/* Tab 3: SMS API Gateway */}
          {activeTab === 'api' && (
            <div className="space-y-4 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
              <div className="text-xs text-gray-700 space-y-1">
                <p className="font-bold text-indigo-900">🌐 SMS Gateway API کے ذریعے SMS:</p>
                {settings?.smsGatewayUrl ? (
                  <p className="text-emerald-700 font-semibold">✓ سیٹنگز میں SMS Gateway API لنک موجود ہے۔</p>
                ) : (
                  <p className="text-amber-700 font-semibold">⚠️ سیٹنگز میں کوئی SMS Gateway API کا لنک درج نہیں ہے۔ براہ کرم پہلے سیٹنگز میں API URL درج کریں۔</p>
                )}
              </div>

              {isSending && (
                <div className="space-y-2 bg-white p-3 rounded-lg border border-indigo-200">
                  <div className="flex justify-between text-xs font-bold text-indigo-800">
                    <span>{statusMsg}</span>
                    <span>{sendProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${sendProgress}%` }}></div>
                  </div>
                </div>
              )}

              <Button 
                onClick={handleSendSmsGatewayApi} 
                disabled={isSending || !settings?.smsGatewayUrl}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 h-auto shadow-md disabled:opacity-50"
              >
                📡 API کے ذریعے سب کو SMS بھیجیں ({orders.length})
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <Button onClick={onClose} variant="secondary" className="px-6 font-bold">
            بند کریں / Close
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ==========================================================
// --- BulkOrderModal Component ---
// ==========================================================
function BulkOrderModal({ orders, onClose }: { orders: Order[], onClose: () => void }) {
  const partners = useMemo(() => {
    return Array.from(new Set(orders.map((o: any) => o.partnerName).filter((name: any) => name && name.trim() !== '')));
  }, [orders]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState({
    trackingNumberCol: -1,
    totalAmountCol: -1,
    customerNameCol: -1,
    customerPhoneCol: -1,
    customerAddressCol: -1,
    customerCityCol: -1,
    partnerNameCol: -1
  });
  
  const [globalDefaults, setGlobalDefaults] = useState({
    carrier: 'Pakistan Post' as 'Pakistan Post' | 'TCS' | 'Leopards',
    labelType: 'VPL' as LabelType,
    deliveryCharges: 0,
    partnerProfitAmount: 0,
    status: 'Pending' as OrderStatus,
    partnerName: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const mValue = (row: any[], colIndex: number) => {
    if (colIndex === undefined || colIndex === null || colIndex < 0 || colIndex >= row.length) return '';
    const cell = row[colIndex];
    if (cell === null || cell === undefined) return '';
    return String(cell).trim();
  };

  const guessColumns = (headersList: string[]) => {
    let trackingNumberCol = -1;
    let totalAmountCol = -1;
    let customerNameCol = -1;
    let customerPhoneCol = -1;
    let customerAddressCol = -1;
    let customerCityCol = -1;
    let partnerNameCol = -1;

    const isSenderTerm = (s: string) => {
      return s.includes('sender') || s.includes('shipper') || s.includes('shiper') || s.includes('from') || s.includes('بھیجنے والا') || s.includes('بھیجنے والے') || s.includes('partner') || s.includes('source');
    };

    const isConsigneeTerm = (s: string) => {
      return s.includes('consignee') || s.includes('recipient') || s.includes('receiver') || s.includes('customer') || s.includes('to') || s.includes('وصول کنندہ') || s.includes('وصول کنندے') || s.includes('کنسائنی') || s.includes('گاہک');
    };

    const lowerHeaders = headersList.map((h, i) => ({
      val: String(h || '').toLowerCase().trim(),
      index: i
    }));

    // 1. Tracking Number Column
    const trackingObj = lowerHeaders.find(h => h.val.includes('consignment') || h.val.includes('track') || h.val.includes('cn') || h.val.includes('کنسائنمنٹ') || h.val.includes('ٹریکنگ') || h.val.includes('ref'));
    if (trackingObj) trackingNumberCol = trackingObj.index;

    // 2. Total Amount Column
    const amountObj = lowerHeaders.find(h => h.val.includes('amount') || h.val.includes('price') || h.val.includes('cod') || h.val.includes('cash') || h.val.includes('رقم') || h.val.includes('اماؤنٹ') || h.val.includes('بل'));
    if (amountObj) totalAmountCol = amountObj.index;

    // 3. Partner / Sender Name Column
    const senderObj = lowerHeaders.find(h => isSenderTerm(h.val) && (h.val.includes('name') || h.val.includes('نام') || h.val.includes('source') || h.val.includes('partner')));
    if (senderObj) {
      partnerNameCol = senderObj.index;
    } else {
      const anySender = lowerHeaders.find(h => isSenderTerm(h.val));
      if (anySender) partnerNameCol = anySender.index;
    }

    // 4. Customer Name Column (consignee details)
    const explicitCustName = lowerHeaders.find(h => isConsigneeTerm(h.val) && (h.val.includes('name') || h.val.includes('نام')));
    if (explicitCustName) {
      customerNameCol = explicitCustName.index;
    } else {
      const cleanName = lowerHeaders.find(h => (h.val.includes('name') || h.val.includes('نام') || h.val.includes('customer') || h.val.includes('گاہک') || h.val.includes('consignee')) && !isSenderTerm(h.val));
      if (cleanName) {
        customerNameCol = cleanName.index;
      } else {
        const fallbackName = lowerHeaders.find(h => h.val.includes('name') || h.val.includes('نام'));
        if (fallbackName) customerNameCol = fallbackName.index;
      }
    }

    // 5. Customer Phone Column
    const explicitCustPhone = lowerHeaders.find(h => isConsigneeTerm(h.val) && (h.val.includes('phone') || h.val.includes('mobile') || h.val.includes('contact') || h.val.includes('نمبر') || h.val.includes('موبائل') || h.val.includes('فون')));
    if (explicitCustPhone) {
      customerPhoneCol = explicitCustPhone.index;
    } else {
      const cleanPhone = lowerHeaders.find(h => (h.val.includes('phone') || h.val.includes('mobile') || h.val.includes('contact') || h.val.includes('نمبر') || h.val.includes('موبائل') || h.val.includes('فون')) && !isSenderTerm(h.val));
      if (cleanPhone) {
        customerPhoneCol = cleanPhone.index;
      } else {
        const fallbackPhone = lowerHeaders.find(h => h.val.includes('phone') || h.val.includes('mobile') || h.val.includes('contact') || h.val.includes('نمبر') || h.val.includes('موبائل') || h.val.includes('فون'));
        if (fallbackPhone) customerPhoneCol = fallbackPhone.index;
      }
    }

    // 6. Customer Address Column
    const explicitCustAddr = lowerHeaders.find(h => isConsigneeTerm(h.val) && (h.val.includes('address') || h.val.includes('delivery') || h.val.includes('destination') || h.val.includes('پتہ') || h.val.includes('ایڈریس')));
    if (explicitCustAddr) {
      customerAddressCol = explicitCustAddr.index;
    } else {
      const cleanAddr = lowerHeaders.find(h => (h.val.includes('address') || h.val.includes('delivery') || h.val.includes('destination') || h.val.includes('پتہ') || h.val.includes('ایڈریس')) && !isSenderTerm(h.val));
      if (cleanAddr) {
        customerAddressCol = cleanAddr.index;
      } else {
        const fallbackAddr = lowerHeaders.find(h => h.val.includes('address') || h.val.includes('delivery') || h.val.includes('destination') || h.val.includes('پتہ') || h.val.includes('ایڈریس'));
        if (fallbackAddr) customerAddressCol = fallbackAddr.index;
      }
    }

    // 7. Customer City Column
    const explicitCustCity = lowerHeaders.find(h => isConsigneeTerm(h.val) && (h.val.includes('city') || h.val.includes('shahar') || h.val.includes('شہر')));
    if (explicitCustCity) {
      customerCityCol = explicitCustCity.index;
    } else {
      const cleanCity = lowerHeaders.find(h => (h.val.includes('city') || h.val.includes('shahar') || h.val.includes('شہر')) && !isSenderTerm(h.val));
      if (cleanCity) {
        customerCityCol = cleanCity.index;
      } else {
        const fallbackCity = lowerHeaders.find(h => h.val.includes('city') || h.val.includes('shahar') || h.val.includes('شہر'));
        if (fallbackCity) customerCityCol = fallbackCity.index;
      }
    }

    return {
      trackingNumberCol,
      totalAmountCol,
      customerNameCol,
      customerPhoneCol,
      customerAddressCol,
      customerCityCol,
      partnerNameCol
    };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file extension because we loosened the input's accept filter for mobile Webview compatibility
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (!fileExt || !['csv', 'xlsx', 'xls'].includes(fileExt)) {
      toast.error("صرف ایکسل (XLSX / XLS) یا سی ایس وی (CSV) فائل سپورٹڈ ہے۔");
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (evt: any) => {
      try {
        const arrBuffer = evt.target.result;
        const data = new Uint8Array(arrBuffer);
        const wb = XLSX.read(data, { type: 'array', codepage: 65001 });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const dataJson = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        if (!dataJson || dataJson.length === 0) {
          toast.error("فائل میں کوئی ڈیٹا نہیں ملا۔");
          return;
        }
        
        // Filter out completely empty rows
        const filteredData = dataJson.filter(r => r && r.length > 0 && r.some(cell => cell !== null && cell !== ''));
        
        if (filteredData.length < 1) {
          toast.error("فائل خالی ہے۔");
          return;
        }
        
        const rawHeaders = (filteredData[0] || []).map(h => String(h || '').trim());
        setHeaders(rawHeaders);
        setRawRows(filteredData.slice(1));
        
        // Auto guess
        const guessed = guessColumns(rawHeaders);
        setMappings(guessed);
        toast.success("فائل کامیابی سے اپ لوڈ ہوگئی!");
      } catch (err) {
        console.error(err);
        toast.error("فائل پڑھنے میں مسئلہ پیش آیا۔");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const previewItems = useMemo(() => {
    if (rawRows.length === 0) return [];
    
    const seenCNsInSheet = new Set<string>();
    
    return rawRows.map((row, idx) => {
      const trackingNumber = mValue(row, mappings.trackingNumberCol) || '';
      const totalAmount = parseFloat(mValue(row, mappings.totalAmountCol)) || 0;
      const customerName = mValue(row, mappings.customerNameCol) || '';
      const customerPhone = mValue(row, mappings.customerPhoneCol) || '';
      const customerAddress = mValue(row, mappings.customerAddressCol) || '';
      const customerCity = mValue(row, mappings.customerCityCol) || '';
      const partnerName = mValue(row, mappings.partnerNameCol) || '';
      
      const normalizedTrack = trackingNumber ? String(trackingNumber).toUpperCase().trim() : '';
      
      const isDuplicateInSystem = normalizedTrack 
        ? orders.some(o => o.trackingNumber && o.trackingNumber.toUpperCase().trim() === normalizedTrack)
        : false;
        
      const isDuplicateInFile = normalizedTrack ? seenCNsInSheet.has(normalizedTrack) : false;
      
      if (normalizedTrack) {
        seenCNsInSheet.add(normalizedTrack);
      }
      
      const isDuplicate = isDuplicateInSystem || isDuplicateInFile;
        
      return {
        id: `item-${idx}`,
        trackingNumber,
        totalAmount,
        customerName,
        customerPhone,
        customerAddress,
        customerCity,
        partnerName,
        isDuplicate,
        isDuplicateInSystem,
        isDuplicateInFile
      };
    });
  }, [rawRows, mappings, orders]);

  useEffect(() => {
    const initialSelected = new Set<string>();
    previewItems.forEach(item => {
      if (item.trackingNumber && !item.isDuplicate) {
        initialSelected.add(item.id);
      }
    });
    setSelectedIds(initialSelected);
  }, [previewItems]);

  const toggleSelectAll = () => {
    const allValid = previewItems.filter(item => item.trackingNumber && !item.isDuplicate);
    if (selectedIds.size === allValid.length) {
      setSelectedIds(new Set());
    } else {
      const nextSet = new Set<string>();
      allValid.forEach(item => nextSet.add(item.id));
      setSelectedIds(nextSet);
    }
  };

  const toggleSelectOne = (id: string) => {
    const item = previewItems.find(i => i.id === id);
    if (item && item.isDuplicate) return; // prevent selecting a duplicate manually
    
    const nextSet = new Set(selectedIds);
    if (nextSet.has(id)) {
      nextSet.delete(id);
    } else {
      nextSet.add(id);
    }
    setSelectedIds(nextSet);
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) {
      toast.error("برائے مہربانی امپورٹ کرنے کے لیے کم از کم ایک آرڈر منتخب کریں۔");
      return;
    }

    const itemsToImport = previewItems.filter(item => selectedIds.has(item.id) && !item.isDuplicate);
    
    if (itemsToImport.length === 0) {
      toast.error("منتخب کردہ تمام آرڈرز نقلی (Duplicate) تھے، اور انہیں چھوڑ دیا گیا۔");
      return;
    }

    // Check if any tracking number is empty
    const invalidItem = itemsToImport.find(i => !i.trackingNumber);
    if (invalidItem) {
      toast.error("صرح وہ آرڈر امپورٹ کیے جا سکتے ہیں جن کا کنسائنمنٹ نمبر موجود ہو۔");
      return;
    }

    setIsSaving(true);
    setSaveProgress('امپورٹ شروع کی جارہی ہے...');

    const mappedOrders = itemsToImport.map(item => {
      return {
        customerName: item.customerName || 'Bulk Customer',
        customerPhone: item.customerPhone || '',
        customerPhone2: '',
        customerAddress: item.customerAddress || '',
        customerCNIC: '',
        customerCity: item.customerCity || '',
        items: [], // empty items, user will add products later
        status: globalDefaults.status,
        labelType: globalDefaults.labelType,
        carrier: globalDefaults.carrier,
        trackingNumber: String(item.trackingNumber).toUpperCase().trim(),
        deliveryCharges: Number(globalDefaults.deliveryCharges) || 0,
        partnerName: item.partnerName || globalDefaults.partnerName || '',
        partnerProfitAmount: Number(globalDefaults.partnerProfitAmount) || 0,
        totalAmount: Number(item.totalAmount) || 0,
        totalProfit: 0,
        paymentReceived: false,
        partnerPaid: false,
        userId: auth.currentUser?.uid,
        createdAt: new Date().toISOString()
      };
    });

    try {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < mappedOrders.length; i += CHUNK_SIZE) {
        const chunk = mappedOrders.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        
        chunk.forEach((orderData) => {
          const orderRef = doc(collection(db, 'orders'));
          batch.set(orderRef, orderData);
        });

        await batch.commit();
        setSaveProgress(`امپورٹ ہورہا ہے: ${Math.min(i + CHUNK_SIZE, mappedOrders.length)} / ${mappedOrders.length}`);
      }
      
      toast.success(`${mappedOrders.length} آرڈرز کامیابی سے امپورٹ ہو گئے۔`);
      onClose();
    } catch (error: any) {
      console.error("Bulk Import Error: ", error);
      toast.error("آرڈرز امپورٹ کرنے میں دشواری پیش آئی۔ " + (error.message || ''));
      handleFirestoreError(error, OperationType.CREATE, 'orders');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = selectedIds.size;
  const totalCODValue = useMemo(() => {
    return previewItems
      .filter(item => selectedIds.has(item.id))
      .reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  }, [previewItems, selectedIds]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-indigo-50">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Download className="w-5 h-5 text-amber-600 rotate-180" />
              بلک آرڈر امپورٹ (Excel / CSV)
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              براہ راست اپنے پاکستان پوسٹ یا کوریئر شیٹ سے بلک میں آرڈرز اپ لوڈ کریں۔ بعد میں ان میں پروڈکٹس لنک کر سکتے ہیں۔
            </p>
          </div>
          <button onClick={onClose} disabled={isSaving} className="text-gray-400 hover:text-gray-700 transition-colors">
            <Plus className="w-6 h-6 rotate-45" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {rawRows.length === 0 ? (
            /* Upload State */
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-200/80 hover:border-indigo-400 rounded-2xl p-10 text-center cursor-pointer transition-all bg-gray-50/50 hover:bg-indigo-50/10 group relative flex flex-col items-center justify-center min-h-[300px]"
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/comma-separated-values,application/octet-stream,*/*" 
                onChange={handleFileChange} 
                className="hidden" 
              />
              <div className="space-y-5 flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Download className="w-8 h-8 text-amber-600 rotate-180 animate-bounce" />
                </div>
                
                <div className="space-y-1">
                  <p className="text-base sm:text-lg font-bold text-gray-900">ایکسل یا سی ایس وی فائل اپلوڈ کریں اور آرڈر بنائیں</p>
                  <p className="text-xs text-gray-500">supports .xlsx, .xls, .csv</p>
                </div>

                <Button 
                  type="button"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation(); // prevent double trigger
                    fileInputRef.current?.click();
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-6 py-3 rounded-xl flex items-center gap-2 shadow-lg shadow-amber-600/20 active:scale-[0.98] transition-all"
                >
                  <Download className="w-4 h-4 rotate-180" />
                  فائل سلیکٹ کریں (Choose File)
                </Button>

                <div className="max-w-md mx-auto text-xs text-indigo-950 border-t border-gray-200/60 pt-4 space-y-1">
                  <p className="font-semibold text-gray-700 flex items-center justify-center gap-1">
                    💡 تجویز کردہ کالم ہیڈرز (کالم کے نام):
                  </p>
                  <p className="font-mono text-[10px] bg-white border rounded px-2 py-1 select-all">
                    Consignment No (ٹریکنگ نمبر) | Cash / Amount (رقم) | Customer Name (گاہک کا نام) | Mobile (فون) | Address (پتہ)
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Settings & Preview State */
            <div className="space-y-6">
              {/* Top Configuration Grid */}
              <div className="grid md:grid-cols-2 gap-5">
                {/* Global Defaults Card */}
                <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/10 border border-indigo-100 p-4.5 rounded-xl space-y-4.5">
                  <h4 className="text-sm font-bold text-indigo-900 border-b border-indigo-200/50 pb-2 flex items-center gap-2" dir="rtl">
                    ⚙️ آرڈرز کے بنیادی ڈیفالٹس (Global Defaults)
                  </h4>
                  <div className="grid grid-cols-2 gap-3.5 text-right" dir="rtl">
                    <div>
                      <Label className="text-indigo-950">کیریئر کوریئر</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-indigo-200 rounded-lg outline-hidden focus:ring-2 focus:ring-indigo-500"
                        value={globalDefaults.carrier}
                        onChange={(e) => {
                          const carrierVal = e.target.value as any;
                          setGlobalDefaults({
                            ...globalDefaults,
                            carrier: carrierVal,
                            labelType: carrierVal === 'Pakistan Post' ? 'VPL' : 'COD'
                          });
                        }}
                      >
                        <option value="Pakistan Post">Pakistan Post (پاکستان پوسٹ)</option>
                        <option value="TCS">TCS (ٹی سی ایس)</option>
                        <option value="Leopards">Leopards (لیوپرڈز)</option>
                      </select>
                    </div>

                    <div>
                      <Label className="text-indigo-950">کسٹمر کا اسٹیٹس</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-indigo-200 rounded-lg outline-hidden focus:ring-2 focus:ring-indigo-500"
                        value={globalDefaults.status}
                        onChange={(e) => setGlobalDefaults({ ...globalDefaults, status: e.target.value as any })}
                      >
                        <option value="Pending">Pending (پینڈنگ)</option>
                        <option value="Packed">Packed (پیکڈ)</option>
                        <option value="Shipped">Shipped (روانہ)</option>
                      </select>
                    </div>

                    <div>
                      <Label className="text-indigo-950">لیبل کی قسم</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-indigo-200 rounded-lg outline-hidden focus:ring-2 focus:ring-indigo-500"
                        value={globalDefaults.labelType}
                        onChange={(e) => setGlobalDefaults({ ...globalDefaults, labelType: e.target.value as any })}
                      >
                        {globalDefaults.carrier === 'Pakistan Post' ? (
                          <>
                            <option value="VPL">VPL</option>
                            <option value="VPP">COD / VPP</option>
                            <option value="PAR">Parcel / PAR</option>
                          </>
                        ) : (
                          <option value="COD">COD (Cash on Delivery)</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <Label className="text-indigo-950">ڈیلیوری چارجز (روپے)</Label>
                      <Input 
                        type="number"
                        min="0"
                        className="h-8.5 bg-white border-indigo-200"
                        value={globalDefaults.deliveryCharges}
                        onChange={(e: any) => setGlobalDefaults({ ...globalDefaults, deliveryCharges: parseFloat(e.target.value) || 0 })}
                      />
                    </div>

                    <div>
                      <Label className="text-indigo-950">ڈیفالٹ مال سپلائر / پارٹنر</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-indigo-200 rounded-lg outline-hidden focus:ring-2 focus:ring-indigo-500"
                        value={globalDefaults.partnerName === '' ? '' : partners.includes(globalDefaults.partnerName) ? globalDefaults.partnerName : 'NEW_PARTNER'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'NEW_PARTNER') {
                            setGlobalDefaults({ ...globalDefaults, partnerName: 'نیا پارٹنر' });
                          } else {
                            setGlobalDefaults({ ...globalDefaults, partnerName: val });
                          }
                        }}
                      >
                        <option value="">-- براہِ راست سیلز (No Partner) --</option>
                        {partners.map(p => <option key={p} value={p}>{p}</option>)}
                        <option value="NEW_PARTNER">-- نیا پارٹنر درج کریں --</option>
                      </select>
                    </div>

                    {(globalDefaults.partnerName !== '' && !partners.includes(globalDefaults.partnerName)) && (
                      <div className="col-span-2 mt-1">
                        <Label className="text-indigo-950 font-bold">نئے سپلائر / پارٹنر کا نام درج کریں</Label>
                        <Input 
                          placeholder="مثلاً علی یا احمد"
                          className="h-8.5 bg-white border-indigo-200 text-right font-medium"
                          value={globalDefaults.partnerName === 'نیا پارٹنر' ? '' : globalDefaults.partnerName}
                          onChange={(e: any) => setGlobalDefaults({ ...globalDefaults, partnerName: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Column Mapper Card */}
                <div className="bg-gradient-to-br from-amber-50/40 to-amber-100/10 border border-amber-100 p-4.5 rounded-xl space-y-4.5">
                  <h4 className="text-sm font-bold text-amber-900 border-b border-amber-200/50 pb-2 flex items-center gap-2" dir="rtl">
                    📋 فائل کالم میچنگ (Column Mapping Alignment)
                  </h4>
                  <div className="grid grid-cols-2 gap-3.5 text-right" dir="rtl">
                    <div>
                      <Label className="text-amber-950 font-bold">کنسائنمنٹ نمبر * (Required)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg font-medium outline-hidden focus:ring-2 focus:ring-amber-500 text-amber-900"
                        value={mappings.trackingNumberCol}
                        onChange={(e) => setMappings({ ...mappings, trackingNumberCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- کالم منتخب کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>

                    <div>
                      <Label className="text-amber-950">آرڈر رقم (Amount)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg outline-hidden focus:ring-2 focus:ring-amber-500"
                        value={mappings.totalAmountCol}
                        onChange={(e) => setMappings({ ...mappings, totalAmountCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- منتخب نہ کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>

                    <div>
                      <Label className="text-amber-950">گاہک کا نام (Customer)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg outline-hidden focus:ring-2 focus:ring-amber-500"
                        value={mappings.customerNameCol}
                        onChange={(e) => setMappings({ ...mappings, customerNameCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- منتخب نہ کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>

                    <div>
                      <Label className="text-amber-950">فون نمبر (Phone)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg outline-hidden focus:ring-2 focus:ring-amber-500"
                        value={mappings.customerPhoneCol}
                        onChange={(e) => setMappings({ ...mappings, customerPhoneCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- منتخب نہ کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>

                    <div>
                      <Label className="text-amber-950">پتہ (Address)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg outline-hidden focus:ring-2 focus:ring-amber-500"
                        value={mappings.customerAddressCol}
                        onChange={(e) => setMappings({ ...mappings, customerAddressCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- منتخب نہ کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>

                    <div>
                      <Label className="text-amber-950">شہر (City)</Label>
                      <select 
                        className="w-full text-xs py-2 px-3 bg-white border border-amber-200 rounded-lg outline-hidden focus:ring-2 focus:ring-amber-500"
                        value={mappings.customerCityCol}
                        onChange={(e) => setMappings({ ...mappings, customerCityCol: parseInt(e.target.value) })}
                      >
                        <option value="-1">-- منتخب نہ کریں --</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parsed List Summary Banner */}
              <div className="flex flex-col sm:flex-row justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-150 gap-4 text-right" dir="rtl">
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    کل {previewItems.length} روز کا ڈیٹا ملا ہے جس میں سے <span className="text-indigo-600 font-extrabold">{selectedCount}</span> امپورٹ کے لیے منتخب ہیں۔
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    سلیکٹڈ رقم کا کل مجموعہ: <span className="font-bold text-emerald-600">{formatCurrency(totalCODValue)}</span>
                  </p>
                </div>
                <div className="flex gap-2 font-bold">
                  <Button variant="secondary" onClick={() => { setRawRows([]); setHeaders([]); setSelectedIds(new Set()); }} className="h-9 text-xs">
                    فائل تبدیل کریں
                  </Button>
                  <Button variant="secondary" onClick={toggleSelectAll} className="h-9 text-xs">
                    {selectedCount === previewItems.filter(item => item.trackingNumber).length ? 'تمام ان-سلیکٹ کریں' : 'تمام سلیکٹ کریں'}
                  </Button>
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-gray-150 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 sticky top-0 text-gray-700 font-bold border-b border-gray-150 text-right" dir="rtl font-bold">
                      <tr>
                        <th className="px-3 py-2.5 text-center w-12">سلیکٹ</th>
                        <th className="px-3 py-2.5 w-16">نمبر شمار</th>
                        <th className="px-4 py-2.5">کنسائنمنٹ / ٹریکنگ نمبر</th>
                        <th className="px-4 py-2.5">رقم (COD Amount)</th>
                        <th className="px-4 py-2.5">گاہک کا نام</th>
                        <th className="px-4 py-2.5">فون نمبر</th>
                        <th className="px-4 py-2.5">شہر و پتہ</th>
                        <th className="px-4 py-2.5 text-center">اسٹیٹس / الرٹ</th>
                      </tr>
                    </thead>
                    <tbody className="text-right" dir="rtl">
                      {previewItems.map((item, idx) => (
                        <tr 
                          key={item.id} 
                          className={cn(
                            "border-b border-gray-100 hover:bg-gray-50 transition-colors",
                            item.isDuplicate && "bg-red-50/20 hover:bg-red-50/40"
                          )}
                        >
                          <td className="px-3 py-2 text-center">
                            <input 
                              type="checkbox" 
                              disabled={!item.trackingNumber || item.isDuplicate}
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelectOne(item.id)}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 disabled:opacity-30"
                            />
                          </td>
                          <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">{idx + 1}</td>
                          <td className="px-4 py-2 font-mono font-bold text-gray-950">
                            {item.trackingNumber ? (
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">{item.trackingNumber}</span>
                            ) : (
                              <span className="text-red-500">مفقود (Missing)</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-bold text-emerald-700">
                            {item.totalAmount > 0 ? formatCurrency(item.totalAmount) : '0'}
                          </td>
                          <td className="px-4 py-2 font-semibold text-gray-800 max-w-[150px] truncate">
                            {item.customerName || <span className="text-gray-400 text-[10px]">-- (ڈیفالٹ کسٹمر)</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-600 font-mono text-[11px]">{item.customerPhone || '--'}</td>
                          <td className="px-4 py-2 text-gray-500 max-w-[200px] truncate text-[11px]">
                            {item.customerCity ? `${item.customerCity} - ` : ''}{item.customerAddress || ''}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {item.isDuplicateInSystem ? (
                              <span className="bg-red-100 text-red-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full inline-block">
                                پہلے سے ریکارڈ میں ہے (System Duplicate)
                              </span>
                            ) : item.isDuplicateInFile ? (
                              <span className="bg-amber-100 text-amber-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full inline-block">
                                شیٹ میں ڈپلیکیٹ ہے (Sheet Duplicate)
                              </span>
                            ) : !item.trackingNumber ? (
                              <span className="bg-orange-150 text-orange-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full inline-block">
                                کنسائنمنٹ نمیر لازمی ہے
                              </span>
                            ) : (
                              <span className="bg-green-100 text-green-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full inline-block font-bold">
                                امپورٹ کے لیے تیار
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end items-center gap-3">
          {isSaving && (
            <p className="text-xs font-bold text-indigo-600 animate-pulse mr-auto" dir="rtl">
              ⏳ {saveProgress}
            </p>
          )}

          <Button 
            onClick={onClose} 
            disabled={isSaving} 
            variant="secondary" 
            className="px-5 font-bold"
          >
            منسوخ کریں / Cancel
          </Button>

          {rawRows.length > 0 && (
            <Button 
              onClick={handleImport} 
              disabled={isSaving || selectedCount === 0 || mappings.trackingNumberCol === -1}
              className="px-6 font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20"
            >
              {isSaving ? 'امپورٹ کیا جارہا ہے...' : `منتخب شدہ امپورٹ کریں (${selectedCount})`}
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
