(function () {
  const root = document.getElementById("stride-visualizer");
  if (!root) {
    return;
  }

  const controls = {
    rows: root.querySelector("#strideRows"),
    cols: root.querySelector("#strideCols"),
    stride0: root.querySelector("#strideDim0"),
    stride1: root.querySelector("#strideDim1"),
    row: root.querySelector("#strideRow"),
  };

  const presets = {
    contiguous: { rows: 3, cols: 4, stride0: 4, stride1: 1 },
    "skip-cols": { rows: 3, cols: 4, stride0: 8, stride1: 2 },
    transposed: { rows: 3, cols: 4, stride0: 1, stride1: 3 },
  };

  const formula = root.querySelector("#strideFormula");
  const status = root.querySelector("#strideStatus");
  const logicalShapeLabel = root.querySelector("#logicalShapeLabel");
  const memoryRangeLabel = root.querySelector("#memoryRangeLabel");
  const logicalGrid = root.querySelector("#logicalGrid");
  const memoryGrid = root.querySelector("#memoryGrid");
  const calculationSteps = root.querySelector("#calculationSteps");
  const calculationTakeaway = root.querySelector("#calculationTakeaway");
  const presetButtons = Array.from(root.querySelectorAll("[data-preset]"));

  const clampInt = (value, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return min;
    }
    return Math.min(Math.max(parsed, min), max);
  };

  const getValue = (input) =>
    clampInt(input.value, Number(input.min), Number(input.max));

  const setValue = (name, value) => {
    controls[name].value = String(value);
  };

  const makeCell = (className, main, sub, label) => {
    const cell = document.createElement("div");
    cell.className = className;
    cell.setAttribute("aria-label", label);

    const mainEl = document.createElement("span");
    mainEl.className = "cell-main";
    mainEl.textContent = main;

    const subEl = document.createElement("span");
    subEl.className = "cell-sub";
    subEl.textContent = sub;

    cell.append(mainEl, subEl);
    return cell;
  };

  const makeCalculationStep = (col, expression) => {
    const item = document.createElement("div");
    item.className = "calculation-step";

    const label = document.createElement("strong");
    label.textContent = `lane ${col}`;

    const code = document.createElement("code");
    code.textContent = expression;

    item.append(label, code);
    return item;
  };

  const describePatten = (addresses, stride1) => {
    if (addresses.length <= 1) {
      return "single column";
    }

    if (stride1 === 0) {
      return "every column points to the same address";
    }

    if (stride1 === 1) {
      return "adjacent memory";
    }

    return "gathered load with gaps";
  };

  const describeTakeaway = (stride1, hasAliases) => {
    if (stride1 === 1 && !hasAliases) {
      return "Column lanes read adjacent addresses, so this row is physically contiguous.";
    }

    if (stride1 === 0) {
      return "All column lanes point at the same address. This is a broadcast-like view, not a normal row scan.";
    }

    if (hasAliases) {
      return "Some logical elements share one address. Strides describe a view, so different coordinates can alias.";
    }

    return "Each lane gets one computed address. Triton loads the vector of addresses, even when there are gaps.";
  };

  const getActivePreset = (rows, cols, stride0, stride1) =>
    Object.entries(presets).find(([, preset]) =>
      preset.rows === rows &&
      preset.cols === cols &&
      preset.stride0 === stride0 &&
      preset.stride1 === stride1
    )?.[0];

  const render = () => {
    const rows = getValue(controls.rows);
    const cols = getValue(controls.cols);
    const stride0 = getValue(controls.stride0);
    const stride1 = getValue(controls.stride1);
    const selectedRow = clampInt(controls.row.value, 0, rows - 1);

    controls.row.max = String(rows - 1);
    controls.row.value = String(selectedRow);

    const addressesByCell = [];
    const ownersByAddress = new Map();
    let maxAddress = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const address = row * stride0 + col * stride1;
        const cell = { row, col, address };
        const owners = ownersByAddress.get(address) || [];

        owners.push(cell);
        ownersByAddress.set(address, owners);
        addressesByCell.push(cell);
        maxAddress = Math.max(maxAddress, address);
      }
    }

    const selectedCells = addressesByCell.filter(
      (cell) => cell.row === selectedRow,
    );
    const selectedAddresses = selectedCells.map((cell) => cell.address);
    const selectedAddressSet = new Set(selectedAddresses);
    const activePreset = getActivePreset(rows, cols, stride0, stride1);
    const hasAliases = Array.from(ownersByAddress.values()).some(
      (owners) => owners.length > 1,
    );
    const aliasText = hasAliases ? " shared addresses present" : "";

    presetButtons.forEach((button) => {
      button.classList.toggle(
        "is-selected",
        button.dataset.preset === activePreset,
      );
    });

    formula.textContent = `offset = row * ${stride0} + col * ${stride1}`;
    status.textContent =
      `row ${selectedRow} loads [${selectedAddresses.join(", ")}] - ` +
      describePatten(selectedAddresses, stride1) +
      aliasText;
    logicalShapeLabel.textContent = `shape = (${rows}, ${cols})`;
    memoryRangeLabel.textContent = `addresses 0..${maxAddress}`;
    calculationTakeaway.textContent = describeTakeaway(stride1, hasAliases);

    calculationSteps.replaceChildren();
    selectedCells.forEach((cell) => {
      calculationSteps.append(
        makeCalculationStep(
          cell.col,
          `${selectedRow} * ${stride0} + ${cell.col} * ${stride1} = ${cell.address}`,
        ),
      );
    });

    logicalGrid.replaceChildren();
    logicalGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    addressesByCell.forEach((cell) => {
      const owners = ownersByAddress.get(cell.address) || [];
      const classes = ["logical-cell", "is-used"];

      if (cell.row === selectedRow) {
        classes.push("is-active");
      }

      if (owners.length > 1) {
        classes.push("is-alias");
      }

      logicalGrid.append(
        makeCell(
          classes.join(" "),
          `r${cell.row} c${cell.col}`,
          `addr ${cell.address}`,
          `logical row ${cell.row}, column ${cell.col}, memory address ${cell.address}`,
        ),
      );
    });

    memoryGrid.replaceChildren();

    for (let address = 0; address <= maxAddress; address += 1) {
      const owners = ownersByAddress.get(address) || [];
      const activeOwners = owners.filter((owner) => owner.row === selectedRow);
      const classes = ["memory-cell"];

      if (owners.length === 0) {
        classes.push("is-empty");
      } else {
        classes.push("is-used");
      }

      if (selectedAddressSet.has(address)) {
        classes.push("is-active");
      }

      if (owners.length > 1) {
        classes.push("is-alias");
      }

      const ownerLabel = activeOwners.length
        ? activeOwners.map((owner) => `c${owner.col}`).join(", ")
        : owners.length
          ? `${owners.length} refs`
          : "empty";

      memoryGrid.append(
        makeCell(
          classes.join(" "),
          String(address),
          ownerLabel,
          `memory address ${address}, ${ownerLabel}`,
        ),
      );
    }
  };

  Object.values(controls).forEach((input) => {
    input.addEventListener("input", render);
    input.addEventListener("change", render);
  });

  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const preset = presets[button.dataset.preset];
      if (!preset) {
        return;
      }

      setValue("rows", preset.rows);
      setValue("cols", preset.cols);
      setValue("stride0", preset.stride0);
      setValue("stride1", preset.stride1);
      setValue("row", 0);
      render();
    });
  });

  render();
})();
