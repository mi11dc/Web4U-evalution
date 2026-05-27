import { Component, OnInit, ViewChild, ElementRef, signal, computed, effect } from '@angular/core';
import { TodoListsClient, TodoItemsClient,
  TodoListDto, TodoItemDto, LookupDto,
  CreateTodoListCommand, UpdateTodoListCommand,
  CreateTodoItemCommand, UpdateTodoItemCommand, UpdateTodoItemDetailCommand
} from '../web-api-client';

@Component({
  standalone: false,
  selector: 'app-todo-component',
  templateUrl: './todo.component.html',
  styleUrls: ['./todo.component.scss']
})
export class TasksComponent implements OnInit {
  @ViewChild('newListDialog') newListDialogRef: ElementRef<HTMLDialogElement>;
  @ViewChild('listOptionsDialog') listOptionsDialogRef: ElementRef<HTMLDialogElement>;
  @ViewChild('deleteListDialog') deleteListDialogRef: ElementRef<HTMLDialogElement>;
  @ViewChild('itemDetailsDialog') itemDetailsDialogRef: ElementRef<HTMLDialogElement>;

  lists = signal<TodoListDto[] | null>(null);
  originalLists = signal<TodoListDto[] | null>(null);
  colours = signal<{ name: string, code: string }[]>([]);
  priorityLevels = signal<LookupDto[]>([]);
  selectedListId = signal<number | null>(null);
  selectedList = computed(() => this.lists()?.find(l => l.id === this.selectedListId()) ?? null);
  selectedItem = signal<TodoItemDto | null>(null);
  editingItem = signal<TodoItemDto | null>(null);
  newListEditor: any = {};
  newListError = signal('');
  listOptionsEditor: any = {};
  itemDetailsEditor: any = {};
  newItemTitle = '';
  newItemDueDate = Date.now();
  addingItem = signal(false);

  priorityFilter = 0;
  completedFilter = 0;

  private originalTitle = '';
  private originalDueDate = 0;
  private editingDueDate = 0;

  minDateForDatePicker = Date.now();

  constructor(
    private listsClient: TodoListsClient,
    private itemsClient: TodoItemsClient
  ) {
    effect(() => { this.selectedListId(); this.newItemTitle = ''; this.addingItem.set(false); });
  }

  ngOnInit(): void {
    this.listsClient.getTodoLists().subscribe({
      next: result => {
        this.originalLists.set(result.lists);
        this.priorityLevels.set(result.priorityLevels);
        this.colours.set(result.colours.map(c => ({ name: c.name, code: c.code })));
        if (result.lists.length) {
          this.selectedListId.set(result.lists[0].id);
        }
        this.filterChange();
      },
      error: error => console.error(error)
    });
  }

  // Lists
  remainingItems(list: TodoListDto): number {
    return list.items.filter(t => !t.done).length;
  }

  showNewListDialog(): void {
    this.newListEditor = { colour: this.colours()[0].code };
    this.newListError.set('');
    this.newListDialogRef.nativeElement.showModal();
    setTimeout(() => document.getElementById('title')?.focus(), 50);
  }

  newListCancelled(): void {
    this.newListDialogRef.nativeElement.close();
    this.newListEditor = {};
    this.newListError.set('');
  }

  addList(): void {
    const list = {
      id: 0,
      title: this.newListEditor.title,
      colour: this.newListEditor.colour,
      items: []
    } as TodoListDto;

    this.listsClient.createTodoList({ title: list.title, colour: list.colour } as CreateTodoListCommand).subscribe({
      next: result => {
        list.id = result;
        this.originalLists.update(ls => [...ls, list]);
        this.selectedListId.set(list.id);
        this.newListDialogRef.nativeElement.close();
        this.newListEditor = {};
        this.newListError.set('');

        this.filterChange();
      },
      error: error => {
        const errors = JSON.parse(error.response).errors;
        if (errors && errors.Title) {
          this.newListError.set(errors.Title[0]);
        }
        setTimeout(() => document.getElementById('title')?.focus(), 50);
      }
    });
  }

  showListOptionsDialog(): void {
    this.listOptionsEditor = {
      id: this.selectedList()!.id,
      title: this.selectedList()!.title,
      colour: this.selectedList()!.colour || this.colours()[0].code
    };
    this.listOptionsDialogRef.nativeElement.showModal();
  }

  closeListOptionsDialog(): void {
    this.listOptionsDialogRef.nativeElement.close();
    this.listOptionsEditor = {};
  }

  updateListOptions(): void {
    const id = this.selectedList()!.id;
    const newTitle = this.listOptionsEditor.title;
    const newColour = this.listOptionsEditor.colour;
    this.listsClient.updateTodoList(id, this.listOptionsEditor as UpdateTodoListCommand).subscribe({
      next: () => {
        this.originalLists.update(ls => ls.map(l => l.id === id ? { ...l, title: newTitle, colour: newColour } as TodoListDto : l));
        this.closeListOptionsDialog();

        this.filterChange();
      },
      error: error => console.error(error)
    });
  }

  confirmDeleteList(): void {
    this.closeListOptionsDialog();
    this.deleteListDialogRef.nativeElement.showModal();
  }

  closeDeleteListDialog(): void {
    this.deleteListDialogRef.nativeElement.close();
  }

  deleteListConfirmed(): void {
    const deletedId = this.selectedList()!.id;
    this.listsClient.deleteTodoList(deletedId).subscribe({
      next: () => {
        this.closeDeleteListDialog();
        this.originalLists.update(ls => ls.filter(l => l.id !== deletedId));
        const remaining = this.originalLists()!;
        this.selectedListId.set(remaining.length ? remaining[0].id : null);
        this.filterChange();
      },
      error: error => console.error(error)
    });
  }

  onSelectedListChange(id: number) {
    this.selectedListId.set(id);
    this.priorityFilter = 0;
    this.completedFilter = 0;
    this.filterChange();
  }

  // Items
  showItemDetailsDialog(item: TodoItemDto): void {
    this.selectedItem.set(item);
    this.itemDetailsEditor = { ...item };
    this.itemDetailsDialogRef.nativeElement.showModal();
  }

  closeItemDetailsDialog(): void {
    this.itemDetailsDialogRef.nativeElement.close();
    this.selectedItem.set(null);
    this.itemDetailsEditor = {};
  }

  updateItemDetails(): void {
    const currentItem = this.selectedItem()!;
    const isMoving = currentItem.listId !== this.itemDetailsEditor.listId;
    this.itemsClient.updateTodoItemDetail(currentItem.id, this.itemDetailsEditor as UpdateTodoItemDetailCommand).subscribe({
      next: () => {
        this.originalLists.update(ls => ls.map(l => {
          if (l.id === currentItem.listId && isMoving) {
            return { ...l, items: l.items.filter(i => i.id !== currentItem.id) } as TodoListDto;
          }
          if (l.id === this.itemDetailsEditor.listId && isMoving) {
            const moved = { ...currentItem, listId: this.itemDetailsEditor.listId, priority: this.itemDetailsEditor.priority, note: this.itemDetailsEditor.note } as TodoItemDto;
            return { ...l, items: [...l.items, moved] } as TodoListDto;
          }
          if (l.id === currentItem.listId) {
            return { ...l, items: l.items.map(i => i.id === currentItem.id
              ? { ...i, priority: this.itemDetailsEditor.priority, note: this.itemDetailsEditor.note } as TodoItemDto
              : i
            )} as TodoListDto;
          }
          return l;
        }));
        this.filterChange();
        this.closeItemDetailsDialog();
      },
      error: error => console.error(error)
    });
  }

  startAddingItem(): void {
    this.addingItem.set(true);
    setTimeout(() => document.getElementById('newItemInput')?.focus(), 50);
  }

  cancelNewItem(): void {
    this.addingItem.set(false);
    this.newItemTitle = '';
    this.newItemDueDate = Date.now();
  }

  commitNewItem(): void {
    this.addingItem.set(false);
    if (!this.newItemTitle.trim() && !this.newItemDueDate) {
      this.newItemTitle = '';
      this.newItemDueDate = Date.now();
      return;
    }
    const listId = this.selectedListId()!;
    const title = this.newItemTitle.trim();
    const dueDate = this.newItemDueDate ? this.newItemDueDate : 0;
    this.itemsClient.createTodoItem({ title, listId, dueDate } as CreateTodoItemCommand).subscribe({
      next: result => {
        this.originalLists.update(ls => ls.map(l => l.id === listId
          ? { ...l, items: [...l.items, { id: result, listId, title, dueDate: dueDate, done: false, priority: this.priorityLevels()[0].id } as TodoItemDto] } as TodoListDto
          : l
        ));
        this.newItemTitle = '';
        this.newItemDueDate = Date.now();

        this.filterChange();
      },
      error: error => console.error(error)
    });
  }

  onDateChange(event, type = 0): void {
    if (!event && !event.srcElement && event.srcElement.value) {
      return;
    }
    if (type === 0) {
      this.newItemDueDate = event.srcElement.valueAsNumber;
    } else {
      this.editingDueDate = event.srcElement.valueAsNumber;
    }
  }

  editItem(item: TodoItemDto, inputId: string): void {
    this.originalTitle = item.title;
    this.originalDueDate = item.dueDate;
    this.editingDueDate = item.dueDate;
    this.editingItem.set(item);
    setTimeout(() => document.getElementById(inputId)?.focus(), 100);
  }

  cancelEdit(): void {
    if (this.editingItem()) {
      this.editingItem()!.title = this.originalTitle;
      this.editingItem()!.dueDate = this.originalDueDate;
    }
    this.editingItem.set(null);
    this.editingDueDate = 0;
  }

  updateItem(item: TodoItemDto): void {
    if (!item.title.trim()) {
      this.deleteItem(item);
      return;
    }

    if (item.id === 0) {
      const listId = this.selectedListId()!;
      this.itemsClient
        .createTodoItem({ title: item.title, listId, dueDate: this.editingDueDate } as CreateTodoItemCommand)
        .subscribe({
          next: result => {
            this.originalLists.update(ls => ls.map(l => l.id === listId
              ? { ...l, items: l.items.map(i => i === item ? { ...i, id: result } as TodoItemDto : i) } as TodoListDto
              : l
            ));
            this.filterChange();
          },
          error: error => console.error(error)
        });
    } else {
      item.dueDate = this.editingDueDate ? this.editingDueDate : 0;
      this.itemsClient.updateTodoItem(item.id, item as UpdateTodoItemCommand).subscribe({
        next: () => console.log('Update succeeded.'),
        error: error => console.error(error)
      });
    }

    this.editingItem.set(null);
    this.editingDueDate = 0;
  }

  deleteItem(item: TodoItemDto): void {
    if (this.itemDetailsDialogRef?.nativeElement.open) {
      this.itemDetailsDialogRef.nativeElement.close();
    }

    const listId = this.selectedListId()!;
    if (item.id === 0) {
      const currentItem = this.selectedItem()!;
      this.originalLists.update(ls => ls.map(l => l.id === listId
        ? { ...l, items: l.items.filter(i => i !== currentItem) } as TodoListDto
        : l
      ));
      this.filterChange();
      this.editingItem.set(null);
      this.editingDueDate = 0;
    } else {
      this.itemsClient.deleteTodoItem(item.id).subscribe({
        next: () => {
          this.originalLists.update(ls => ls.map(l => l.id === listId
            ? { ...l, items: l.items.filter(i => i.id !== item.id) } as TodoListDto
            : l
          ));
          this.filterChange();
        },
        error: error => console.error(error)
      });
    }
  }

  filterChange(): void {
    if (!this.selectedListId() && !this.originalLists()) {
      return;
    }

    const completed = Number(this.completedFilter);
    const priority = Number(this.priorityFilter);

    const filtered = this.originalLists().map(list => {
      if (list.id === this.selectedListId()) {
        const items = list.items.filter(item => {
          // done filter
          const matchesDone =
            completed === 0
              ? true
              : completed === 1
                ? item.done === false
                : item.done === true;

          // priority filter
          const matchesPriority = priority === 0 ? true : item.priority === priority;

          return matchesDone && matchesPriority;
        }) as TodoItemDto[];
        return { ...list, items: items.map(i => ({ ...i })) } as TodoListDto;
      }
      return list as TodoListDto
    });

    this.lists.set(filtered);

    // Only Priority Filter
    // if (this.priorityFilter?.toString() === '0') {
    //   this.lists.set(this.originalLists());
    //   return;
    // }

    // this.lists.set(
    //   this.originalLists()?.map(ol =>
    //     ol.id === this.selectedListId()
    //       ? ({
    //         ...ol,
    //         items: ol.items.filter(
    //           i => i.priority?.toString() === this.priorityFilter?.toString() 
    //         ) as TodoItemDto[]
    //       } as TodoListDto)
    //       : ol
    //   ) ?? []
    // );
  }

  checkDueDate(item: TodoItemDto): boolean {
    let bool = false;
    if (item?.dueDate?.toString() === '0' && !item.done) {
      bool = !bool;
      return bool;
    }

    if (item.done) {
      return bool;
    }

    // Only considering Date for dueDate
    const currentDateTS= new Date((new Date()).toJSON().split('T')[0]).getTime();
    const itemDateTS = new Date(new Date(item?.dueDate).toJSON()?.split('T')[0])?.getTime();
    if (itemDateTS < currentDateTS) {
      bool = !bool;
      return bool;
    }

    return bool;
  }
}
