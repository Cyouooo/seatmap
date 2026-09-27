import { describe, it, expect } from 'vitest';
import { useStore } from './store';
import { makeBlock } from './lib/layout';

function setDoc() {
  const block = makeBlock({ x: 0, y: 0, showSeats: true, cols: 2, rows: 2, seatPrefix: 'A' });
  useStore.setState({
    doc: { version: 0, updatedAt: '', floors: [{ id: 'f1', name: '5F', blocks: [block] }] },
    floorId: 'f1',
    past: [],
    future: [],
    mode: 'edit',
  });
  return block.id;
}

describe('store 撤销合并', () => {
  it('同一工位同一字段的连续输入合并为一步撤销', () => {
    const id = setDoc();
    const st = useStore.getState();
    st.updateSeat(id, 0, { seatNo: 'A' });
    st.updateSeat(id, 0, { seatNo: 'A-0' });
    st.updateSeat(id, 0, { seatNo: 'A-01' });
    expect(useStore.getState().past.length).toBe(1);
    expect(useStore.getState().doc.floors[0].blocks[0].seats[0].seatNo).toBe('A-01');
  });
  it('不同字段各自入栈', () => {
    const id = setDoc();
    const st = useStore.getState();
    st.updateSeat(id, 0, { seatNo: 'A-01' });
    st.updateSeat(id, 0, { machineSN: 'SN-1' });
    expect(useStore.getState().past.length).toBe(2);
  });
  it('工位批量：多选后批量设置 / 清空', () => {
    const id = setDoc();
    const st = useStore.getState();
    st.setSeatBatchMode(true);
    st.seatToggle(id, 0);
    st.seatToggle(id, 1);
    expect(useStore.getState().seatIds.length).toBe(2);

    useStore.getState().seatSetField('机器SN', 'BATCH-SN');
    const seats = useStore.getState().doc.floors[0].blocks[0].seats;
    expect(seats[0].machineSN).toBe('BATCH-SN');
    expect(seats[1].machineSN).toBe('BATCH-SN');
    expect(seats[2].machineSN).toBe('');

    useStore.getState().seatClearMany();
    const after = useStore.getState().doc.floors[0].blocks[0].seats;
    expect(after[0].seatNo).toBe('');
    expect(useStore.getState().seatIds.length).toBe(0);
  });
  it('退出编辑模式清空编辑/批量状态并还原查看态选中', () => {
    const id = setDoc();
    useStore.setState({ mode: 'view', sel: { kind: 'block', blockId: id }, viewSel: null });
    const viewSel = { kind: 'block', blockId: id } as const;

    useStore.getState().setMode('edit');
    expect(useStore.getState().viewSel).toEqual(viewSel);
    expect(useStore.getState().sel).toBeNull();

    useStore.getState().setSeatBatchMode(true);
    useStore.getState().seatToggle(id, 0);
    expect(useStore.getState().seatBatchMode).toBe(true);
    expect(useStore.getState().seatIds.length).toBe(1);

    useStore.getState().setMode('view');
    const s = useStore.getState();
    expect(s.mode).toBe('view');
    expect(s.seatBatchMode).toBe(false);
    expect(s.seatIds).toEqual([]);
    expect(s.batchMode).toBe(false);
    expect(s.batchIds).toEqual([]);
    expect(s.sel).toEqual(viewSel);
  });
});
