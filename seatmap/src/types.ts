export interface SeatField {
  key: string;
  label: string;
  value: string;
}

export interface Seat {
  seatNo: string;
  machineSN: string;
  portNo: string;
  fields: SeatField[];
}

export interface Block {
  id: string;
  /** 画布坐标（左上角） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 区域显示文本，默认 "X区" */
  text: string;
  /** 主题色 #RRGGBB */
  color: string;
  /** 座位列数 */
  cols: number;
  /** 座位行数 */
  rows: number;
  /** 是否显示座位；false 时只显示居中文案 */
  showSeats: boolean;
  /** 座位号前缀 */
  seatPrefix: string;
  /** 该控件是否参与自动吸附（默认 true） */
  snapEnabled?: boolean;
  seats: Seat[];
}

export interface Floor {
  id: string;
  name: string;
  blocks: Block[];
}

export interface LayoutDoc {
  version: number;
  updatedAt: string;
  /** 全局：工位上显示哪个属性（默认“座位号”） */
  seatLabelField?: string;
  floors: Floor[];
}

export type Selection =
  | { kind: 'block'; blockId: string }
  | { kind: 'seat'; blockId: string; seatIndex: number };

export interface Match {
  floorId: string;
  blockId: string;
  seatIndex: number;
  seatNo: string;
  level: 'strong' | 'weak';
  hitField: string;
  hitValue: string;
}

export interface ImportChange {
  field: string;
  from: string;
  to: string;
}

export interface ImportRow {
  seatNo: string;
  floorId: string;
  floorName: string;
  blockText: string;
  status: 'update' | 'same' | 'notfound';
  changes: ImportChange[];
}

export interface ImportPreview {
  importId: string;
  keyField: string;
  sheet: string;
  total: number;
  updated: number;
  same: number;
  newFields: string[];
  notFound: string[];
  rows: ImportRow[];
}

export interface ImportResult {
  updated: number;
  newFields: string[];
  notFound: string[];
  floors: string[];
}
