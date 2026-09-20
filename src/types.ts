export interface AppUser {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  updatedAt?: string;
}

export type OrderStatus = 'Pending' | 'Packed' | 'Shipped' | 'Delivered' | 'Returned' | 'Cancelled';
export type LabelType = 'VPL' | 'VPP' | 'PAR' | 'COD';

export interface Product {
  id: string;
  name: string;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  lowStockThreshold: number;
  supplierName?: string;
  userId?: string;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  customerPhone2?: string;
  customerAddress: string;
  customerCity: string;
  customerCNIC?: string;
  trackingNumber: string;
  items: OrderItem[];
  totalAmount: number;
  totalProfit: number;
  deliveryCharges: number;
  partnerName: string;
  partnerProfitAmount: number;
  status: OrderStatus;
  labelType: LabelType;
  paymentReceived: boolean;
  paymentReceivedAt?: string;
  partnerPaid: boolean;
  partnerPaidAt?: string;
  carrier?: 'Pakistan Post' | 'TCS' | 'Leopards';
  lastTrackingEvent?: string;
  lastTrackingLocation?: string;
  lastTrackingDate?: string;
  userId?: string;
  createdAt: string;
}

export interface FieldPosition {
  x: number; // in mm from left
  y: number; // in mm from top
  fontSize: number; // in px
  fontWeight?: 'normal' | 'bold';
  visible: boolean;
  maxWidth?: number; // in mm max container width for wrapping
}

export interface MoneyOrderConfig {
  bgImage?: string; // base64 or URL of the form background
  showBgInPreview: boolean;
  isLocked: boolean;
  fields: {
    trackingNumberTop: FieldPosition;
    dateTop: FieldPosition;
    amountRs: FieldPosition;
    codArticleNo: FieldPosition;
    amountWordsEng: FieldPosition;
    amountDigitsUrdu: FieldPosition;
    amountWordsUrdu: FieldPosition;
    customerName: FieldPosition;
    customerAddress: FieldPosition;
    customerCNIC: FieldPosition;
    senderName: FieldPosition;
    senderAddress: FieldPosition;
    senderCNIC: FieldPosition;
    signatureDate: FieldPosition;
  };
}

export interface Settings {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  senderCity: string;
  senderCNIC?: string;
  whatsappProvider?: 'meta' | 'ultramsg' | 'manual';
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
  metaWabaId?: string;
  metaMessageType?: 'text' | 'template' | 'auto';
  metaTemplateName?: string;
  metaTemplateLanguage?: string;
  ultraMsgInstanceId?: string;
  ultraMsgToken?: string;
  smsGatewayUrl?: string;
  userId?: string;
}

export interface StockLog {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
  reason?: string;
  userId?: string;
  createdAt: string;
}

export interface BillItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Bill {
  id: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerPhone2?: string;
  items: BillItem[];
  subtotal: number;
  discount: number;
  total: number;
  userId?: string;
  createdAt: string;
}

export interface RegularCustomer {
  id: string;
  name: string;
  phone: string;
  phone2?: string;
  address: string;
  rates: { [productIdOrName: string]: number };
  defaultDiscount?: number;
  notes?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Debt {
  id: string;
  borrowerName: string;
  amount: number;
  description?: string;
  isPaid: boolean;
  userId?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  userId?: string;
  createdAt: string;
}
