import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { collection, onSnapshot, query, orderBy, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Product, Settings, Bill, Order, RegularCustomer } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { safeHtml2Canvas } from '../lib/html2canvasUtil';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { 
  FileText, 
  Download, 
  Trash2, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Search, 
  Users, 
  Sparkles, 
  RotateCcw, 
  Layers, 
  Printer, 
  Share2, 
  Phone, 
  MapPin, 
  Tag, 
  X, 
  Edit3, 
  Check, 
  ArrowRight,
  ChevronDown
} from 'lucide-react';

interface BillMakerViewProps {
  products: Product[];
  settings: Settings | null;
  bills: Bill[];
  orders?: Order[];
}

export function BillMakerView({ products, settings, bills, orders = [] }: BillMakerViewProps) {
  // Customer details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerPhone2, setCustomerPhone2] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [rememberCustomerRates, setRememberCustomerRates] = useState(true);

  // Mode: 'grid' (Fast Multi-Product Sheet - Qty Only) | 'manual' (Single Add)
  const [entryMode, setEntryMode] = useState<'grid' | 'manual'>('grid');

  // Fast Sheet Grid State
  const [gridQuantities, setGridQuantities] = useState<Record<string, number>>({});
  const [gridRates, setGridRates] = useState<Record<string, number>>({});
  const [productSearch, setProductSearch] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // Autocomplete & History UI
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [loadedHistoryInfo, setLoadedHistoryInfo] = useState<{
    customerName: string;
    date: string;
    itemCount: number;
    totalAmount: number;
  } | null>(null);

  // Manual items state (for custom / walk-in extra items)
  const [manualItems, setManualItems] = useState<any[]>([]);
  const [selectedManualProdId, setSelectedManualProdId] = useState('');
  const [manualItemName, setManualItemName] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualPrice, setManualPrice] = useState(0);

  // Regular Customers Store
  const [regularCustomers, setRegularCustomers] = useState<RegularCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingRegularCustomer, setEditingRegularCustomer] = useState<RegularCustomer | null>(null);

  // Realtime subscription to regularCustomers
  useEffect(() => {
    try {
      const q = query(collection(db, 'regularCustomers'), orderBy('name', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: RegularCustomer[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...(doc.data() as any) });
        });
        setRegularCustomers(list);
      }, (err) => {
        console.warn('Regular customers snapshot notice:', err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('Failed to listen to regularCustomers:', e);
    }
  }, []);

  // Initialize product rates when products change
  useEffect(() => {
    setGridRates((prevRates) => {
      const updated = { ...prevRates };
      products.forEach((p) => {
        if (updated[p.id] === undefined) {
          updated[p.id] = p.sellingPrice;
        }
      });
      return updated;
    });
  }, [products]);

  // Comprehensive Customer Suggestions & Past Purchase History
  const customerSuggestions = useMemo(() => {
    interface PastTransaction {
      id: string;
      type: 'bill' | 'order';
      date: string;
      items: Array<{
        productId?: string;
        name: string;
        quantity: number;
        price: number;
        total: number;
      }>;
      total: number;
      discount?: number;
    }

    interface CustEntry {
      id?: string;
      name: string;
      phone: string;
      phone2?: string;
      address: string;
      isRegular: boolean;
      rates?: Record<string, number>;
      defaultDiscount?: number;
      purchases: PastTransaction[];
      latestPurchase?: PastTransaction;
      lastItemsSummary?: string;
      totalPurchasesCount: number;
    }

    const map = new Map<string, CustEntry>();

    const getCleanKey = (name: string) => name.trim().toLowerCase();

    // 1. Regular customers first (highest priority for base profile)
    regularCustomers.forEach((rc) => {
      if (rc.name) {
        const key = getCleanKey(rc.name);
        map.set(key, {
          id: rc.id,
          name: rc.name.trim(),
          phone: rc.phone || '',
          phone2: rc.phone2 || '',
          address: rc.address || '',
          isRegular: true,
          rates: rc.rates || {},
          defaultDiscount: rc.defaultDiscount || 0,
          purchases: [],
          totalPurchasesCount: 0
        });
      }
    });

    // Helper to add past bills
    bills.forEach((b) => {
      if (b.customerName && b.customerName.trim()) {
        const key = getCleanKey(b.customerName);
        let entry = map.get(key);
        if (!entry) {
          entry = {
            name: b.customerName.trim(),
            phone: b.customerPhone || '',
            phone2: b.customerPhone2 || '',
            address: b.customerAddress || '',
            isRegular: false,
            purchases: [],
            totalPurchasesCount: 0
          };
          map.set(key, entry);
        } else {
          if (!entry.phone && b.customerPhone) entry.phone = b.customerPhone;
          if (!entry.phone2 && b.customerPhone2) entry.phone2 = b.customerPhone2;
          if (!entry.address && b.customerAddress) entry.address = b.customerAddress;
        }

        const validItems = (b.items || []).map((it) => ({
          productId: (it as any).productId || '',
          name: it.name || '',
          quantity: Number(it.quantity) || 1,
          price: Number(it.price) || 0,
          total: Number(it.total) || (Number(it.quantity) || 1) * (Number(it.price) || 0)
        }));

        if (validItems.length > 0) {
          entry.purchases.push({
            id: b.id,
            type: 'bill',
            date: b.createdAt || '',
            items: validItems,
            total: b.total || 0,
            discount: b.discount || 0
          });
        }
      }
    });

    // Helper to add past orders
    orders.forEach((o) => {
      if (o.customerName && o.customerName.trim()) {
        const key = getCleanKey(o.customerName);
        let entry = map.get(key);
        if (!entry) {
          entry = {
            name: o.customerName.trim(),
            phone: o.customerPhone || '',
            phone2: o.customerPhone2 || '',
            address: o.customerAddress || '',
            isRegular: false,
            purchases: [],
            totalPurchasesCount: 0
          };
          map.set(key, entry);
        } else {
          if (!entry.phone && o.customerPhone) entry.phone = o.customerPhone;
          if (!entry.phone2 && o.customerPhone2) entry.phone2 = o.customerPhone2;
          if (!entry.address && o.customerAddress) entry.address = o.customerAddress;
        }

        const validItems = (o.items || []).map((it) => ({
          productId: it.productId || '',
          name: it.name || '',
          quantity: Number(it.quantity) || 1,
          price: Number(it.price) || 0,
          total: (Number(it.quantity) || 1) * (Number(it.price) || 0)
        }));

        if (validItems.length > 0) {
          entry.purchases.push({
            id: o.id,
            type: 'order',
            date: o.createdAt || '',
            items: validItems,
            total: o.totalAmount || 0,
            discount: 0
          });
        }
      }
    });

    // Sort purchases for each customer by newest date first & generate summaries
    map.forEach((entry) => {
      entry.purchases.sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
      });
      entry.totalPurchasesCount = entry.purchases.length;
      if (entry.purchases.length > 0) {
        entry.latestPurchase = entry.purchases[0];
        const summary = entry.latestPurchase.items
          .slice(0, 3)
          .map((i) => `${i.quantity}x ${i.name}`)
          .join(', ');
        entry.lastItemsSummary =
          summary + (entry.latestPurchase.items.length > 3 ? '...' : '');
      }
    });

    return Array.from(map.values());
  }, [regularCustomers, bills, orders]);

  // Main customer selection function: Loads customer details AND their previous items automatically!
  const handleSelectCustomer = (
    custName: string,
    specificPurchaseId?: string
  ) => {
    if (!custName || !custName.trim()) {
      setSelectedCustomerId('');
      setLoadedHistoryInfo(null);
      return;
    }

    const found = customerSuggestions.find(
      (c) => c.name.toLowerCase().trim() === custName.toLowerCase().trim()
    );

    if (found) {
      setSelectedCustomerId(found.id || '');
      setCustomerName(found.name);
      if (found.phone) setCustomerPhone(found.phone);
      if (found.phone2) setCustomerPhone2(found.phone2);
      if (found.address) setCustomerAddress(found.address);
      if (found.defaultDiscount !== undefined) setDiscount(found.defaultDiscount);

      // Determine which past transaction to load (either specific or latest)
      let targetPurchase = found.latestPurchase;
      if (specificPurchaseId && found.purchases.length > 0) {
        const p = found.purchases.find((pur) => pur.id === specificPurchaseId);
        if (p) targetPurchase = p;
      }

      // Base Rates Setup
      const newRates: Record<string, number> = {};
      products.forEach((p) => {
        if (found.rates && found.rates[p.id] !== undefined) {
          newRates[p.id] = found.rates[p.id];
        } else if (found.rates && found.rates[p.name] !== undefined) {
          newRates[p.id] = found.rates[p.name];
        } else {
          newRates[p.id] = p.sellingPrice;
        }
      });

      // Load previous items and quantities!
      if (targetPurchase && targetPurchase.items && targetPurchase.items.length > 0) {
        const newQuantities: Record<string, number> = {};
        const newManualItems: any[] = [];

        targetPurchase.items.forEach((item) => {
          // 1. Try finding product by ID
          let matchedProduct = products.find((p) => p.id === item.productId);

          // 2. If not found by ID, try finding by name (case-insensitive & trimmed)
          if (!matchedProduct && item.name) {
            const cleanItemName = item.name.trim().toLowerCase();
            matchedProduct = products.find(
              (p) => p.name.trim().toLowerCase() === cleanItemName
            );
          }

          if (matchedProduct) {
            newQuantities[matchedProduct.id] =
              (newQuantities[matchedProduct.id] || 0) + (item.quantity || 1);
            // Apply price from previous bill if not explicitly overridden by customer rate
            if (
              found.rates === undefined ||
              (found.rates[matchedProduct.id] === undefined &&
                found.rates[matchedProduct.name] === undefined)
            ) {
              if (item.price && item.price > 0) {
                newRates[matchedProduct.id] = item.price;
              }
            }
          } else {
            // Unmatched custom/manual item
            newManualItems.push({
              id: Math.random().toString(36).substr(2, 9),
              productId: '',
              name: item.name,
              quantity: item.quantity || 1,
              price: item.price || 0,
              total: (item.quantity || 1) * (item.price || 0)
            });
          }
        });

        setGridQuantities(newQuantities);
        setManualItems(newManualItems);
        setGridRates(newRates);

        if (targetPurchase.discount !== undefined && targetPurchase.discount > 0) {
          setDiscount(targetPurchase.discount);
        }

        // Auto filter to show the loaded items so the user can just edit quantities!
        setShowSelectedOnly(true);

        const formattedDate = targetPurchase.date
          ? format(new Date(targetPurchase.date), 'dd MMM, yyyy')
          : 'پچھلا آرڈر';

        setLoadedHistoryInfo({
          customerName: found.name,
          date: formattedDate,
          itemCount: targetPurchase.items.length,
          totalAmount: targetPurchase.total
        });

        toast.success(
          `✨ "${found.name}" کا پچھلا مال (${targetPurchase.items.length} آئٹمز) خودکار لوڈ ہو گیا! آپ صرف تعداد (+ / -) تبدیل کریں۔`,
          { duration: 4500 }
        );
      } else {
        // No previous purchase found, apply rates only
        setGridRates(newRates);
        setLoadedHistoryInfo(null);
        if (found.isRegular) {
          toast.success(`⭐ ریگولر کسٹمر "${found.name}" کے خصوصی ریٹس لوڈ ہو گئے!`);
        } else {
          toast.success(`گاہک "${found.name}" کی تفصیلات لوڈ ہو گئیں!`);
        }
      }
    } else {
      setCustomerName(custName);
      setLoadedHistoryInfo(null);
    }
    setShowNameSuggestions(false);
  };

  // Re-load last purchase items manually if desired
  const handleReloadLastPurchase = () => {
    if (!customerName.trim()) {
      toast.error('براہ کرم پہلے گاہک منتخب کریں۔');
      return;
    }
    handleSelectCustomer(customerName);
  };

  // Quantity and Rate handlers for Grid
  const handleQuantityChange = (productId: string, valStr: string) => {
    const qty = parseInt(valStr, 10);
    const safeQty = isNaN(qty) || qty < 0 ? 0 : qty;
    setGridQuantities((prev) => ({
      ...prev,
      [productId]: safeQty
    }));
  };

  const adjustQty = (productId: string, delta: number) => {
    setGridQuantities((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      return {
        ...prev,
        [productId]: next
      };
    });
  };

  const handleRateChange = (productId: string, valStr: string) => {
    const rate = parseFloat(valStr);
    const safeRate = isNaN(rate) || rate < 0 ? 0 : rate;
    setGridRates((prev) => ({
      ...prev,
      [productId]: safeRate
    }));
  };

  // Clear all quantities
  const handleClearAllQuantities = () => {
    if (Object.values(gridQuantities).some((q) => q > 0) || manualItems.length > 0) {
      if (confirm('کیا آپ تمام پراڈکٹس کی تعداد صفر (خالی) کرنا چاہتے ہیں؟')) {
        setGridQuantities({});
        setManualItems([]);
        toast.success('بل کے تمام آئٹمز صفر کر دیے گئے۔');
      }
    }
  };

  // Reset all rates to default selling price
  const handleResetRates = () => {
    const defaultRates: Record<string, number> = {};
    products.forEach((p) => {
      defaultRates[p.id] = p.sellingPrice;
    });
    setGridRates(defaultRates);
    toast.success('تمام ریٹس ڈیفالٹ قیمتِ فروخت پر ریسیٹ ہو گئے۔');
  };

  // Manual Item Add
  const handleAddManualItem = () => {
    let itemName = manualItemName.trim();
    let productId = selectedManualProdId;

    if (selectedManualProdId) {
      const p = products.find((prod) => prod.id === selectedManualProdId);
      if (p) {
        itemName = p.name;
        productId = p.id;
      }
    }

    if (!itemName) {
      toast.error('براہ کرم پروڈکٹ کا نام لکھیں یا منتخب کریں۔');
      return;
    }

    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      productId,
      name: itemName,
      quantity: Math.max(1, manualQty),
      price: Math.max(0, manualPrice),
      total: Math.max(1, manualQty) * Math.max(0, manualPrice)
    };

    setManualItems([...manualItems, newItem]);
    setSelectedManualProdId('');
    setManualItemName('');
    setManualQty(1);
    setManualPrice(0);
    toast.success(`آئٹم "${itemName}" شامل ہو گیا!`);
  };

  const removeManualItem = (id: string) => {
    setManualItems(manualItems.filter((i) => i.id !== id));
  };

  // Active items from Fast Sheet Grid (where qty > 0)
  const gridActiveItems = useMemo(() => {
    return products
      .filter((p) => (gridQuantities[p.id] || 0) > 0)
      .map((p) => {
        const qty = gridQuantities[p.id] || 0;
        const rate = gridRates[p.id] !== undefined ? gridRates[p.id] : p.sellingPrice;
        return {
          id: p.id,
          productId: p.id,
          name: p.name,
          quantity: qty,
          price: rate,
          total: qty * rate,
          isManual: false,
          stock: p.stock
        };
      });
  }, [products, gridQuantities, gridRates]);

  const formattedManualItems = useMemo(() => {
    return manualItems.map((item) => ({
      ...item,
      isManual: true
    }));
  }, [manualItems]);

  // Combined all bill items
  const allBillItems = useMemo(() => {
    return [...gridActiveItems, ...formattedManualItems];
  }, [gridActiveItems, formattedManualItems]);

  // Unified item quantity update
  const handleUpdateItemQty = (item: any, deltaOrVal: number, isDirect: boolean = false) => {
    if (item.isManual) {
      setManualItems((prev) =>
        prev
          .map((i) => {
            if (i.id === item.id) {
              const newQty = isDirect ? Math.max(0, deltaOrVal) : Math.max(0, i.quantity + deltaOrVal);
              return { ...i, quantity: newQty, total: newQty * i.price };
            }
            return i;
          })
          .filter((i) => i.quantity > 0)
      );
    } else {
      if (isDirect) {
        setGridQuantities((prev) => ({
          ...prev,
          [item.id]: Math.max(0, deltaOrVal)
        }));
      } else {
        adjustQty(item.id, deltaOrVal);
      }
    }
  };

  // Unified item price update
  const handleUpdateItemPrice = (item: any, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    if (item.isManual) {
      setManualItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, price: validPrice, total: i.quantity * validPrice } : i))
      );
    } else {
      setGridRates((prev) => ({
        ...prev,
        [item.id]: validPrice
      }));
    }
  };

  // Unified item removal
  const handleRemoveBillItem = (item: any) => {
    if (item.isManual) {
      removeManualItem(item.id);
    } else {
      setGridQuantities((prev) => ({
        ...prev,
        [item.id]: 0
      }));
    }
    toast.success(`"${item.name}" بل سے ہٹا دیا گیا۔`);
  };

  const totalItemCount = allBillItems.length;
  const totalUnits = allBillItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = allBillItems.reduce((sum, item) => sum + item.total, 0);
  const total = Math.max(0, subtotal - discount);

  // Filtered products for grid view
  const filteredGridProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.supplierName && p.supplierName.toLowerCase().includes(productSearch.toLowerCase()));
      const matchesSelected = !showSelectedOnly || (gridQuantities[p.id] || 0) > 0;
      return matchesSearch && matchesSelected;
    });
  }, [products, productSearch, showSelectedOnly, gridQuantities]);

  // Save customer's custom rates to Firestore
  const saveCustomerProfileRates = async (
    custName: string,
    custPhone: string,
    custPhone2: string,
    custAddress: string,
    ratesMap: Record<string, number>,
    disc: number
  ) => {
    if (!custName.trim()) return;
    try {
      const existing = regularCustomers.find(
        (c) =>
          c.name.toLowerCase().trim() === custName.toLowerCase().trim() ||
          (custPhone && c.phone === custPhone)
      );

      const customerData: any = {
        name: custName.trim(),
        phone: custPhone.trim(),
        phone2: custPhone2.trim(),
        address: custAddress.trim(),
        rates: ratesMap,
        defaultDiscount: disc || 0,
        userId: auth.currentUser?.uid,
        updatedAt: new Date().toISOString()
      };

      if (existing) {
        await updateDoc(doc(db, 'regularCustomers', existing.id), customerData);
      } else {
        customerData.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'regularCustomers'), customerData);
      }
    } catch (e) {
      console.error('Error auto-saving regular customer profile:', e);
    }
  };

  // Save Bill handler
  const handleSaveBill = async () => {
    if (!customerName.trim()) {
      toast.error('براہ کرم گاہک کا نام درج کریں۔');
      return;
    }
    if (allBillItems.length === 0) {
      toast.error('براہ کرم کم از کم ایک پروڈکٹ کی تعداد درج کریں۔');
      return;
    }

    setIsSaving(true);
    try {
      const billData: Omit<Bill, 'id'> = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerPhone2: customerPhone2.trim(),
        customerAddress: customerAddress.trim(),
        items: allBillItems,
        subtotal,
        discount,
        total,
        userId: auth.currentUser?.uid,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'bills'), billData);

      // Save customer profile & rates if requested
      if (rememberCustomerRates) {
        await saveCustomerProfileRates(
          customerName,
          customerPhone,
          customerPhone2,
          customerAddress,
          gridRates,
          discount
        );
      }

      toast.success('🎉 بل کامیابی سے محفوظ ہو گیا!');

      // Reset form
      setCustomerName('');
      setCustomerPhone('');
      setCustomerPhone2('');
      setCustomerAddress('');
      setGridQuantities({});
      setManualItems([]);
      setDiscount(0);
      setSelectedCustomerId('');
    } catch (error) {
      console.error(error);
      toast.error('بل محفوظ کرنے میں خرابی پیش آگئی۔');
    } finally {
      setIsSaving(false);
    }
  };

  // Download PDF
  const downloadBill = async (billToDownload?: Bill) => {
    const data = billToDownload || {
      customerName: customerName || 'Walk-in Customer',
      customerPhone,
      customerPhone2,
      customerAddress,
      items: allBillItems,
      subtotal,
      discount,
      total,
      createdAt: new Date().toISOString()
    };

    if (!data.items || data.items.length === 0) {
      toast.error('بل میں کوئی آئٹم نہیں ہے!');
      return;
    }

    const toastId = toast.loading('پی ڈی ایف بل تیار ہو رہا ہے...');

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);

    const rootDiv = document.createElement('div');
    container.appendChild(rootDiv);
    const root = createRoot(rootDiv);

    await new Promise<void>((resolve) => {
      root.render(<BillTemplate bill={data} settings={settings} />);
      setTimeout(resolve, 800);
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

      pdf.save(`Bill_${data.customerName || 'Customer'}_${format(new Date(data.createdAt), 'yyyyMMdd_HHmm')}.pdf`);
      toast.success('پی ڈی ایف بل ڈاؤن لوڈ ہو گیا!', { id: toastId });
    } catch (error) {
      console.error('Bill generation failed:', error);
      toast.error('بل پی ڈی ایف تیار کرنے میں ناکامی۔', { id: toastId });
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  };

  // WhatsApp Bill Sharing
  const handleShareWhatsApp = (billToShare?: Bill) => {
    const data = billToShare || {
      customerName,
      customerPhone,
      customerAddress,
      items: allBillItems,
      subtotal,
      discount,
      total,
      createdAt: new Date().toISOString()
    };

    if (!data.items || data.items.length === 0) {
      toast.error('بل میں کوئی آئٹم موجود نہیں ہے!');
      return;
    }

    const cleanPhone = (data.customerPhone || '').replace(/\D/g, '');
    let msg = `*📜 بن ناصر دواخانہ کراچی - بل / انوائس*\n`;
    msg += `--------------------------------\n`;
    msg += `👤 *گاہک:* ${data.customerName || 'معزز کسٹمر'}\n`;
    if (data.customerPhone) msg += `📞 *فون:* ${data.customerPhone}\n`;
    if (data.customerAddress) msg += `📍 *پتہ:* ${data.customerAddress}\n`;
    msg += `📅 *تاریخ:* ${format(new Date(data.createdAt), 'dd-MM-yyyy, hh:mm a')}\n`;
    msg += `--------------------------------\n`;
    msg += `*آئٹمز کی تفصیل:*\n`;
    data.items.forEach((it: any, idx: number) => {
      msg += `${idx + 1}. *${it.name}*\n   تعداد: ${it.quantity} عدد | ریٹ: Rs ${it.price.toLocaleString()} | کل: Rs ${it.total.toLocaleString()}\n`;
    });
    msg += `--------------------------------\n`;
    msg += `💵 *کل رقم (Subtotal):* Rs ${data.subtotal.toLocaleString()}\n`;
    if (data.discount > 0) msg += `🏷️ *رعایت (Discount):* Rs ${data.discount.toLocaleString()}\n`;
    msg += `💰 *صاف واجب الادا رقم:* Rs ${data.total.toLocaleString()}\n`;
    msg += `--------------------------------\n`;
    msg += `شکریہ! برائے رابطہ: 03474763051\n`;

    const formattedPhone = cleanPhone
      ? cleanPhone.startsWith('92')
        ? cleanPhone
        : '92' + cleanPhone.replace(/^0/, '')
      : '';
    const url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  // Delete Bill
  const handleDeleteBill = async (id: string) => {
    if (!confirm('کیا آپ واقعی یہ بل سسٹم سے ختم کرنا چاہتے ہیں؟')) return;
    try {
      await deleteDoc(doc(db, 'bills', id));
      toast.success('بل ختم کر دیا گیا!');
    } catch (error) {
      console.error(error);
      toast.error('بل ڈیلیٹ کرنے میں خرابی۔');
    }
  };

  const isCurrentCustomerRegular = Boolean(
    regularCustomers.some(
      (rc) =>
        rc.name.toLowerCase().trim() === customerName.toLowerCase().trim() &&
        customerName.trim() !== ''
    )
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 text-right"
      dir="rtl"
    >
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-gray-900">
                بل بنانے والا و ریگولر کسٹمر ریٹس
              </h2>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                ریگولر کسٹمرز کے پہلے سے سیٹ شدہ ریٹ خودکار لوڈ کریں، صرف تعداد ڈالیں اور بل تیار کریں
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomerModal(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Users className="w-4 h-4 text-amber-600" />
            <span>ریگولر کسٹمرز لسٹ ({regularCustomers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => downloadBill()}
            disabled={allBillItems.length === 0}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-all flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-2xs"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>PDF ڈاؤن لوڈ</span>
          </button>

          <button
            type="button"
            onClick={() => handleShareWhatsApp()}
            disabled={allBillItems.length === 0}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-sm"
          >
            <Share2 className="w-4 h-4" />
            <span>واٹس ایپ بل</span>
          </button>

          <button
            type="button"
            onClick={handleSaveBill}
            disabled={isSaving || allBillItems.length === 0}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-md shadow-indigo-600/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSaving ? 'محفوظ ہو رہا ہے...' : 'بل محفوظ کریں'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Customer & Items vs Saved Bills */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8-9 cols: Customer info + Product Items entry */}
        <div className="lg:col-span-8 space-y-6">
          {/* Card 1: Customer Info & Quick Auto-Fill */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                  گاہک کی تفصیل و خودکار پچھلا مال (Customer & Previous Orders)
                </h3>
                {isCurrentCustomerRegular && (
                  <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200">
                    ⭐ ریگولر کسٹمر
                  </span>
                )}
              </div>

              {/* Fast Customer Picker */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-semibold">کسٹمر منتخب کریں:</span>
                <select
                  className="text-xs py-1.5 px-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg font-bold text-indigo-900 outline-hidden focus:ring-2 focus:ring-indigo-500 cursor-pointer max-w-[220px]"
                  value={customerName}
                  onChange={(e) => handleSelectCustomer(e.target.value)}
                >
                  <option value="">-- محفوظ گاہک چنیں --</option>
                  {customerSuggestions.map((c, i) => (
                    <option key={i} value={c.name}>
                      {c.isRegular ? `⭐ ${c.name}` : c.name} {c.phone ? `(${c.phone})` : ''} {c.totalPurchasesCount > 0 ? `[${c.totalPurchasesCount} بل]` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
              {/* Customer Name with Live Autocomplete */}
              <div className="relative">
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  گاہک کا نام *
                </label>
                <input
                  type="text"
                  value={customerName}
                  onFocus={() => setShowNameSuggestions(true)}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setShowNameSuggestions(true);
                  }}
                  placeholder="مثلاً حاجی عبداللہ / خان میڈیکل"
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />

                {/* Autocomplete Suggestions Popup */}
                {showNameSuggestions && customerName.trim().length > 0 && (
                  <div className="absolute top-full right-0 left-0 mt-1 bg-white rounded-xl shadow-xl border border-slate-200 z-50 max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {customerSuggestions
                      .filter((c) =>
                        c.name.toLowerCase().includes(customerName.toLowerCase()) ||
                        c.phone.includes(customerName)
                      )
                      .slice(0, 6)
                      .map((c, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSelectCustomer(c.name)}
                          className="p-2.5 hover:bg-indigo-50 cursor-pointer transition-colors text-right"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-gray-900 flex items-center gap-1">
                              {c.isRegular && <span className="text-amber-500">⭐</span>}
                              {c.name}
                            </span>
                            {c.phone && (
                              <span className="text-[11px] text-indigo-600 font-mono dir-ltr">
                                {c.phone}
                              </span>
                            )}
                          </div>
                          {c.lastItemsSummary && (
                            <p className="text-[10px] text-emerald-700 font-semibold mt-0.5 truncate">
                              📦 پچھلا مال: {c.lastItemsSummary}
                            </p>
                          )}
                          {c.address && (
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">
                              📍 {c.address}
                            </p>
                          )}
                        </div>
                      ))}
                    <div
                      onClick={() => setShowNameSuggestions(false)}
                      className="p-1.5 text-center text-[10px] text-gray-400 bg-slate-50 cursor-pointer hover:bg-slate-100"
                    >
                      بند کریں (Close)
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  فون نمبر 1
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="03xx-xxxxxxx"
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium dir-ltr text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  فون نمبر 2 (اختیاری)
                </label>
                <input
                  type="text"
                  value={customerPhone2}
                  onChange={(e) => setCustomerPhone2(e.target.value)}
                  placeholder="03xx-xxxxxxx"
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium dir-ltr text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  پتہ و شہر
                </label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="شہر یا دکان کا مکمل پتہ"
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
            </div>

            {/* PREVIOUS ORDER / BILL STATUS BANNER */}
            {(() => {
              const currentCust = customerSuggestions.find(
                (c) => c.name.toLowerCase().trim() === customerName.toLowerCase().trim()
              );
              if (!currentCust || currentCust.purchases.length === 0) return null;

              return (
                <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs shadow-xs">
                        📦
                      </span>
                      <div>
                        <h4 className="text-xs font-black text-emerald-950">
                          گاہک کا پچھلا مال لوڈ شدہ ہے ({loadedHistoryInfo ? loadedHistoryInfo.itemCount : currentCust.latestPurchase?.items.length || 0} اشیاء)
                        </h4>
                        <p className="text-[11px] text-emerald-800 font-medium">
                          {loadedHistoryInfo
                            ? `آخری خریداری بتاریخ: ${loadedHistoryInfo.date} (کل رقم: Rs ${loadedHistoryInfo.totalAmount.toLocaleString()})`
                            : currentCust.lastItemsSummary}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleReloadLastPurchase}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                        title="دوبارہ پچھلا مال لوڈ کریں"
                      >
                        <RotateCcw className="w-3 h-3 text-emerald-600" />
                        <span>دوبارہ لوڈ کریں</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border',
                          showSelectedOnly
                            ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                            : 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-50'
                        )}
                      >
                        {showSelectedOnly ? '✓ صرف پچھلی اشیاء' : 'تمام پروڈکٹس دکھائیں'}
                      </button>
                    </div>
                  </div>

                  {/* Multi-Bill Selector if customer has multiple bills */}
                  {currentCust.purchases.length > 1 && (
                    <div className="flex items-center gap-2 pt-1 border-t border-emerald-200/60 text-xs">
                      <span className="text-[11px] font-bold text-emerald-900 shrink-0">
                        📅 دیگر تاریخوں کے بل:
                      </span>
                      <select
                        className="text-[11px] py-1 px-2.5 bg-white border border-emerald-300 rounded-lg font-bold text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer max-w-full"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleSelectCustomer(currentCust.name, e.target.value);
                          }
                        }}
                      >
                        <option value="">-- کسی دوسرے بل سے مال لوڈ کریں ({currentCust.purchases.length} دستیاب) --</option>
                        {currentCust.purchases.map((pur, pIdx) => (
                          <option key={pur.id || pIdx} value={pur.id}>
                            {pur.date ? format(new Date(pur.date), 'dd MMM yyyy, hh:mm a') : `بل #${pIdx + 1}`} - Rs {pur.total.toLocaleString()} ({pur.items.length} آئٹمز)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Remember customer rates toggle */}
            <div className="flex items-center justify-between bg-indigo-50/60 border border-indigo-100 p-2.5 rounded-xl text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-indigo-950">
                <input
                  type="checkbox"
                  checked={rememberCustomerRates}
                  onChange={(e) => setRememberCustomerRates(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-indigo-300 focus:ring-indigo-500 cursor-pointer"
                />
                <span>
                  💾 اس گاہک کے درج کردہ ریٹ (Rates) اور تفصیلات مستقبل کے لیے بطور ریگولر کسٹمر محفوظ رکھیں
                </span>
              </label>

              {customerName.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    saveCustomerProfileRates(
                      customerName,
                      customerPhone,
                      customerPhone2,
                      customerAddress,
                      gridRates,
                      discount
                    );
                    toast.success(`گاہک "${customerName}" کے ریٹس کامیابی سے محفوظ ہو گئے!`);
                  }}
                  className="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer shrink-0"
                >
                  ⭐ ریٹ ابھی سیو کریں
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Products Entry (Fast Bulk Grid vs Manual Add) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            {/* Mode Switcher & Tools */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setEntryMode('grid')}
                  className={cn(
                    'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer',
                    entryMode === 'grid'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>⚡ تیز رفتار لسٹ {gridActiveItems.length > 0 ? `(${gridActiveItems.length})` : ''}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEntryMode('manual')}
                  className={cn(
                    'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer',
                    entryMode === 'manual'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Plus className="w-3.5 h-3.5 text-indigo-600" />
                  <span>➕ سنگل / دستی موڈ {allBillItems.length > 0 ? `(${allBillItems.length})` : ''}</span>
                </button>
              </div>

              {entryMode === 'grid' && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search box */}
                  <div className="relative min-w-[180px]">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-2.5" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="پروڈکٹ تلاش کریں..."
                      className="w-full text-xs pr-8 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
                    {productSearch && (
                      <button
                        onClick={() => setProductSearch('')}
                        className="absolute left-2 top-2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filter selected only */}
                  <button
                    type="button"
                    onClick={() => setShowSelectedOnly(!showSelectedOnly)}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer flex items-center gap-1',
                      showSelectedOnly
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-white text-gray-600 border-slate-200 hover:bg-slate-50'
                    )}
                  >
                    <span>صرف شامل کردہ ({gridActiveItems.length})</span>
                  </button>

                  {/* Clear all */}
                  {gridActiveItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllQuantities}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 transition-colors cursor-pointer"
                      title="سب صفر کریں"
                    >
                      خالی کریں
                    </button>
                  )}

                  {/* Reset rates */}
                  <button
                    type="button"
                    onClick={handleResetRates}
                    className="p-1.5 rounded-lg text-xs font-bold text-gray-600 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                    title="ریٹس ریسیٹ کریں"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* TAB 1: Fast Multi-Product Sheet / Grid Mode */}
            {entryMode === 'grid' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 font-semibold">
                  <span>
                    💡 <strong className="text-gray-800">طریقہ استعمال:</strong> ریٹ پہلے سے سیٹ ہے۔ آپ بس مطلوبہ پروڈکٹ کے سامنے <strong className="text-indigo-700">تعداد (Qty)</strong> درج کریں، بل خود بخود بنتا جائے گا۔
                  </span>
                  <span className="font-bold text-indigo-700">
                    کل پروڈکٹس: {products.length}
                  </span>
                </div>

                {/* Grid Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white max-h-[440px] overflow-y-auto">
                  <table className="w-full text-xs text-right border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-gray-700 font-bold">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3">پروڈکٹ کا نام (Product Name)</th>
                        <th className="py-2.5 px-3 w-20 text-center">اسٹاک</th>
                        <th className="py-2.5 px-3 w-32 text-center">سیٹ شدہ ریٹ (Rs)</th>
                        <th className="py-2.5 px-3 w-40 text-center">تعداد (Quantity)</th>
                        <th className="py-2.5 px-3 w-28 text-left">کل رقم (Total)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredGridProducts.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-gray-400 font-bold">
                            کوئی پروڈکٹ نہیں ملی
                          </td>
                        </tr>
                      ) : (
                        filteredGridProducts.map((prod, idx) => {
                          const currentQty = gridQuantities[prod.id] || 0;
                          const currentRate =
                            gridRates[prod.id] !== undefined
                              ? gridRates[prod.id]
                              : prod.sellingPrice;
                          const rowTotal = currentQty * currentRate;
                          const isSelected = currentQty > 0;

                          return (
                            <tr
                              key={prod.id}
                              className={cn(
                                'transition-colors',
                                isSelected
                                  ? 'bg-emerald-50/60 hover:bg-emerald-50'
                                  : 'hover:bg-slate-50/80'
                              )}
                            >
                              <td className="py-2 px-3 text-center text-gray-400 font-mono text-[11px]">
                                {idx + 1}
                              </td>

                              <td className="py-2 px-3">
                                <div className="font-bold text-gray-900 text-xs sm:text-sm">
                                  {prod.name}
                                </div>
                                {prod.supplierName && (
                                  <div className="text-[10px] text-gray-500 font-medium">
                                    سپلائر: {prod.supplierName}
                                  </div>
                                )}
                              </td>

                              <td className="py-2 px-3 text-center">
                                <span
                                  className={cn(
                                    'px-2 py-0.5 rounded-full text-[10px] font-bold inline-block',
                                    prod.stock <= prod.lowStockThreshold
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-100 text-slate-700'
                                  )}
                                >
                                  {prod.stock} عدد
                                </span>
                              </td>

                              {/* Rate Input */}
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <span className="text-gray-400 text-[10px]">Rs</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={currentRate}
                                    onChange={(e) => handleRateChange(prod.id, e.target.value)}
                                    className="w-20 text-center py-1 px-1.5 rounded-lg border border-slate-200 bg-white font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                                  />
                                </div>
                              </td>

                              {/* Quantity Controls & Input */}
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => adjustQty(prod.id, -1)}
                                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                                  >
                                    -
                                  </button>

                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={currentQty === 0 ? '' : currentQty}
                                    onChange={(e) => handleQuantityChange(prod.id, e.target.value)}
                                    className={cn(
                                      'w-16 text-center py-1 px-1.5 rounded-lg border font-black text-sm focus:outline-none focus:ring-2 transition-all',
                                      isSelected
                                        ? 'border-emerald-500 bg-white text-emerald-900 ring-2 ring-emerald-200'
                                        : 'border-slate-200 bg-slate-50 text-gray-800 focus:bg-white focus:ring-indigo-500'
                                    )}
                                  />

                                  <button
                                    type="button"
                                    onClick={() => adjustQty(prod.id, 1)}
                                    className="w-6 h-6 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                                  >
                                    +
                                  </button>

                                  {/* Quick Stepper +5 or +10 */}
                                  <button
                                    type="button"
                                    onClick={() => adjustQty(prod.id, 5)}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                                    title="+5 عدد شامل کریں"
                                  >
                                    +5
                                  </button>
                                </div>
                              </td>

                              {/* Row Total */}
                              <td className="py-2 px-3 text-left font-black text-xs sm:text-sm">
                                {rowTotal > 0 ? (
                                  <span className="text-emerald-700 font-black">
                                    {formatCurrency(rowTotal)}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">0</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: Manual Single Item Add Mode */}
            {entryMode === 'manual' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-xs font-bold text-gray-700">
                      پروڈکٹ کا نام
                    </label>
                    <div className="flex flex-col gap-2">
                      <select
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium focus:ring-2 focus:ring-indigo-500 outline-hidden"
                        value={selectedManualProdId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setSelectedManualProdId(pid);
                          const p = products.find((prod) => prod.id === pid);
                          if (p) {
                            setManualItemName(p.name);
                            setManualPrice(p.sellingPrice);
                          }
                        }}
                      >
                        <option value="">اسٹاک سے منتخب کریں</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (اسٹاک: {p.stock}) - Rs {p.sellingPrice}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        placeholder="یا خود ہاتھ سے نام درج کریں..."
                        value={manualItemName}
                        onChange={(e) => setManualItemName(e.target.value)}
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium focus:ring-2 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-700">قیمت (Rs)</label>
                    <input
                      type="number"
                      min="0"
                      value={manualPrice}
                      onChange={(e) => setManualPrice(Number(e.target.value))}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-700">تعداد (Qty)</label>
                    <input
                      type="number"
                      min="1"
                      value={manualQty}
                      onChange={(e) => setManualQty(Number(e.target.value))}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddManualItem}
                      disabled={!manualItemName.trim() && !selectedManualProdId}
                      className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-sm"
                    >
                      <Plus className="w-4 h-4" /> شامل کریں
                    </button>
                  </div>
                </div>

                {/* All Bill Items in Single Mode */}
                {allBillItems.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>موجودہ بل میں شامل تمام اشیاء ({allBillItems.length} اقسام)</span>
                      </h4>
                      <span className="text-[11px] text-gray-500 font-semibold">
                        کل تعداد: <strong className="text-indigo-700 font-bold">{totalUnits} عدد</strong>
                      </span>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                      <table className="w-full text-xs text-right border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200 text-gray-700 font-bold">
                          <tr>
                            <th className="py-2.5 px-3">آئٹم کا نام</th>
                            <th className="py-2.5 px-3 text-center w-28">قیمت (Rs)</th>
                            <th className="py-2.5 px-3 text-center w-36">تعداد</th>
                            <th className="py-2.5 px-3 text-left w-24">کل رقم</th>
                            <th className="py-2.5 px-3 text-center w-12">عمل</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allBillItems.map((item, idx) => (
                            <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-gray-900 text-xs sm:text-sm">
                                  {item.name}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {item.isManual ? (
                                    <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">
                                      دستی آئٹم
                                    </span>
                                  ) : (
                                    <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.2 rounded">
                                      اسٹاک پروڈکٹ
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Price Edit */}
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.price}
                                  onChange={(e) =>
                                    handleUpdateItemPrice(item, Number(e.target.value))
                                  }
                                  className="w-20 text-center py-1 px-1.5 rounded-lg border border-slate-200 bg-white font-bold text-indigo-900 text-xs focus:ring-2 focus:ring-indigo-500"
                                />
                              </td>

                              {/* Quantity Stepper & Input */}
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateItemQty(item, -1)}
                                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      handleUpdateItemQty(
                                        item,
                                        Number(e.target.value) || 0,
                                        true
                                      )
                                    }
                                    className="w-12 text-center py-1 px-1 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateItemQty(item, 1)}
                                    className="w-6 h-6 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>

                              {/* Row Total */}
                              <td className="py-2.5 px-3 text-left font-black text-xs text-emerald-700">
                                {formatCurrency(item.total)}
                              </td>

                              {/* Action Delete */}
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveBillItem(item)}
                                  className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
                                  title="بل سے نکالیں"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-gray-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                    بل میں فی الحال کوئی آئٹم شامل نہیں ہے۔ اوپر سے شامل کریں یا تیز رفتار لسٹ استعمال کریں۔
                  </div>
                )}
              </div>
            )}

            {/* Bill Summary & Subtotal */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="bg-white px-3 py-2 rounded-lg border border-slate-200">
                  <span className="text-gray-500 font-medium">شامل کردہ آئٹمز: </span>
                  <strong className="text-indigo-900 font-bold">{totalItemCount} اقسام</strong>
                </div>
                <div className="bg-white px-3 py-2 rounded-lg border border-slate-200">
                  <span className="text-gray-500 font-medium">کل تعداد: </span>
                  <strong className="text-indigo-900 font-bold">{totalUnits} عدد</strong>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-gray-600 font-bold">کل رقم (Subtotal):</span>
                  <span className="font-bold text-gray-900 text-sm">{formatCurrency(subtotal)}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-gray-600 font-bold">رعایت (Discount):</span>
                  <input
                    type="number"
                    min="0"
                    value={discount === 0 ? '' : discount}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-24 text-right py-1 px-2 border border-slate-200 rounded-lg bg-white font-bold text-xs focus:ring-2 focus:ring-indigo-500 outline-hidden"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-slate-200 text-base">
                  <span className="font-extrabold text-gray-900">صاف رقم (Grand Total):</span>
                  <span className="font-black text-indigo-700 text-lg sm:text-xl">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 cols: Saved Bills Ledger & History */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col h-full">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-gray-900 text-sm">محفوظ شدہ بلز (Saved Bills)</h3>
              </div>
              <span className="text-xs bg-indigo-50 text-indigo-700 font-extrabold px-2 py-0.5 rounded-full border border-indigo-100">
                {bills.length} بلز
              </span>
            </div>

            {/* List of Saved Bills */}
            <div className="flex-1 overflow-y-auto space-y-3 max-h-[750px] pr-0.5">
              {bills.length === 0 ? (
                <div className="text-center py-12 text-gray-400 italic text-xs font-bold space-y-1">
                  <FileText className="w-8 h-8 text-gray-300 mx-auto" />
                  <p>ابھی تک کوئی بل محفوظ نہیں کیا گیا</p>
                </div>
              ) : (
                bills.map((bill) => (
                  <div
                    key={bill.id}
                    className="p-3.5 bg-slate-50/70 hover:bg-white rounded-xl border border-slate-200/70 hover:border-indigo-300 transition-all shadow-2xs group space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 text-xs truncate">
                          {bill.customerName}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1 font-sans">
                          {bill.customerPhone && <span>📞 {bill.customerPhone} •</span>}
                          <span>{format(new Date(bill.createdAt), 'dd MMM yyyy, hh:mm a')}</span>
                        </p>
                      </div>

                      <div className="text-left shrink-0">
                        <p className="text-xs sm:text-sm font-black text-indigo-700">
                          {formatCurrency(bill.total)}
                        </p>
                        <span className="text-[10px] text-gray-500 font-semibold">
                          {bill.items?.length || 0} آئٹمز
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => handleShareWhatsApp(bill)}
                        className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                        title="واٹس ایپ پر بھیجیں"
                      >
                        <Share2 className="w-3 h-3" /> واٹس ایپ
                      </button>

                      <button
                        type="button"
                        onClick={() => downloadBill(bill)}
                        className="px-2 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                        title="PDF ڈاؤن لوڈ کریں"
                      >
                        <Download className="w-3 h-3" /> PDF
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteBill(bill.id)}
                        className="p-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg text-[10px] transition-colors cursor-pointer shadow-2xs"
                        title="بل ختم کریں"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Regular Customers Directory & Rate Profiles */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden"
          >
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-gray-900 text-base">
                  ریگولر کسٹمرز و ان کے خصوصی ریٹس (Regular Customers Directory)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustomerModal(false);
                  setEditingRegularCustomer(null);
                }}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <p className="text-xs text-gray-600">
                یہاں آپ کے تمام ریگولر کسٹمرز اور ان کے مخصوص سیٹ کردہ ریٹ محفوظ ہیں۔ جب بھی آپ ان کا نام منتخب کریں گے، ان کے ریٹ خودکار لوڈ ہو جائیں گے۔
              </p>

              <div className="space-y-3">
                {regularCustomers.length === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-xs font-bold italic">
                    ابھی تک کوئی ریگولر کسٹمر محفوظ نہیں ہے۔ بل بناتے وقت گاہک کا نام لکھیں اور "ریٹ محفوظ رکھیں" پر ٹک لگائیں۔
                  </div>
                ) : (
                  regularCustomers.map((rc) => {
                    const rateCount = Object.keys(rc.rates || {}).length;
                    const custInfo = customerSuggestions.find(
                      (c) => c.name.toLowerCase().trim() === rc.name.toLowerCase().trim()
                    );
                    return (
                      <div
                        key={rc.id}
                        className="p-4 bg-slate-50 hover:bg-indigo-50/40 rounded-xl border border-slate-200 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 text-sm">⭐ {rc.name}</span>
                            {rc.phone && (
                              <span className="text-xs text-indigo-700 font-mono dir-ltr font-semibold">
                                {rc.phone}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{rc.address || 'کوئی پتہ درج نہیں'}</p>
                          
                          {custInfo?.lastItemsSummary && (
                            <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                              📦 آخری خریدی گئی اشیاء: {custInfo.lastItemsSummary}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                              ✓ {rateCount} پروڈکٹس کے خصوصی ریٹ سیٹ ہیں
                            </span>
                            {rc.defaultDiscount ? (
                              <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
                                رعایت: Rs {rc.defaultDiscount}
                              </span>
                            ) : null}
                            {custInfo && custInfo.totalPurchasesCount > 0 && (
                              <span className="text-[10px] bg-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded-full">
                                {custInfo.totalPurchasesCount} پچھلے بل محفوظ
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectCustomer(rc.name);
                              setShowCustomerModal(false);
                            }}
                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <span>⚡ پچھلے مال کے ساتھ منتخب کریں</span>
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`کیا آپ واقعی ریگولر کسٹمر "${rc.name}" کو لسٹ سے ڈیلیٹ کرنا چاہتے ہیں؟`)) {
                                await deleteDoc(doc(db, 'regularCustomers', rc.id));
                                toast.success('کسٹمر لسٹ سے ختم ہو گیا۔');
                              }
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="ڈیلیٹ کریں"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                بند کریں / Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

// Printable & Downloadable Invoice Template
export function BillTemplate({ bill, settings }: { bill: any; settings: Settings | null }) {
  return (
    <div
      style={{
        padding: '40px',
        backgroundColor: '#ffffff',
        width: '800px',
        color: '#111827',
        fontFamily: '"Inter", "Noto Sans Arabic", sans-serif',
        position: 'relative',
        minHeight: '1000px'
      }}
    >
      {/* Background Watermark Logo */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotate(-30deg)',
          opacity: 0.05,
          fontSize: '120px',
          fontWeight: '900',
          color: '#4f46e5',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 0,
          textAlign: 'center'
        }}
      >
        BIN NASIR
        <br />
        DAWAKHANA
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '4px solid #4f46e5',
            paddingBottom: '24px',
            marginBottom: '32px'
          }}
        >
          <div>
            <h1 style={{ fontSize: '40px', fontWeight: '900', color: '#4f46e5', margin: '0 0 4px 0' }}>
              بن ناصر دواخانہ کراچی
            </h1>
            <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e1b4b', margin: 0 }}>
              Bin Nasir Dawakhana Karachi
            </p>
            <p style={{ fontSize: '15px', color: '#4f46e5', fontWeight: 'bold', marginTop: '6px' }}>
              Ph: 03474763051
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ fontSize: '30px', fontWeight: '900', color: '#9ca3af', margin: 0 }}>
              بل (INVOICE)
            </h2>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>
              تاریخ (Date): {format(new Date(bill.createdAt || new Date()), 'PPP')}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginBottom: '35px' }}>
          <div>
            <h3
              style={{
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#9ca3af',
                marginBottom: '8px'
              }}
            >
              Bill To / کسٹمر کی تفصیل
            </h3>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px 0' }}>
              {bill.customerName || 'Walk-in Customer'}
            </p>
            <p style={{ fontSize: '14px', margin: '0 0 4px 0' }}>
              {bill.customerPhone}
              {bill.customerPhone2 ? ` / ${bill.customerPhone2}` : ''}
            </p>
            <p style={{ fontSize: '14px', margin: 0 }}>{bill.customerAddress}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h3
              style={{
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#9ca3af',
                marginBottom: '8px'
              }}
            >
              From / منجانب
            </h3>
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px 0' }}>
              Bin Nasir Dawakhana Karachi
            </p>
            <p style={{ fontSize: '14px', margin: '0 0 4px 0' }}>03474763051</p>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '35px' }}>
          <thead>
            <tr
              style={{
                textAlign: 'left',
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#ffffff',
                backgroundColor: '#4f46e5'
              }}
            >
              <th style={{ padding: '12px 16px' }}>Item / تفصیل</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>Qty / تعداد</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Price / قیمت</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Total / کل رقم</th>
            </tr>
          </thead>
          <tbody>
            {bill.items &&
              bill.items.map((item: any, index: number) => (
                <tr
                  key={index}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb'
                  }}
                >
                  <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>{item.name}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 'bold' }}>
                    {item.quantity}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    {formatCurrency(item.price)}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 'bold' }}>
                    {formatCurrency(item.total)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #f3f4f6'
              }}
            >
              <span style={{ color: '#6b7280' }}>Subtotal / کل رقم:</span>
              <span style={{ fontWeight: 'bold' }}>{formatCurrency(bill.subtotal || 0)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #f3f4f6'
              }}
            >
              <span style={{ color: '#6b7280' }}>Discount / رعایت:</span>
              <span style={{ fontWeight: 'bold', color: '#dc2626' }}>
                -{formatCurrency(bill.discount || 0)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '14px 0',
                marginTop: '6px',
                borderTop: '2px solid #4f46e5'
              }}
            >
              <span style={{ fontSize: '17px', fontWeight: 'bold' }}>Grand Total / واجب الادا:</span>
              <span style={{ fontSize: '22px', fontWeight: '900', color: '#4f46e5' }}>
                {formatCurrency(bill.total || 0)}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '70px',
            paddingTop: '30px',
            borderTop: '1px solid #f3f4f6',
            textAlign: 'center'
          }}
        >
          <p style={{ fontSize: '15px', fontWeight: 'bold', color: '#4f46e5', marginBottom: '6px' }}>
            شکریہ! دوبارہ تشریف لائیں
          </p>
          <p style={{ fontSize: '11px', color: '#9ca3af' }}>This is a computer generated invoice.</p>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
            Generated by ShipFlow Manager
          </p>
        </div>
      </div>
    </div>
  );
}
