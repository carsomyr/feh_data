/*
 * Copyright 2017 Roy Liu
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

var iStatNames = ["hp", "atk", "spd", "def", "res"];
var hStatNames = ["H", "A", "S", "D", "R"];
var bannerNamePattern = new RegExp("^Banner: (.*)$");

/* Calculates the IV (invidual values) for a hero. */
function FEH_IV() {
  var tuple = getIvIndicesAndMerges();
  var ivIndices = tuple[0];
  
  var indexHigh = ivIndices.indexOf(0);
  var indexLow = ivIndices.indexOf(2);
  
  if (indexHigh >= 0 && indexLow >= 0) {
    return Utilities.formatString("+%s/-%s", iStatNames[indexHigh], iStatNames[indexLow]);
  } else if (indexHigh === -1 && indexLow === -1) {
    return "neutral";
  } else {
    throw "Invalid IV";
  }
}

/* Calculates the merge profile (the distribution of raised stats) for a hero. */
function FEH_MERGES() {
  var tuple = getIvIndicesAndMerges();
  var merges = tuple[1];

  var statIncreaseTotal = merges.reduce(function (memo, statIncrease) {
    return memo + statIncrease;
  }, 0);
  
  var mergeProfile = ~~(statIncreaseTotal / 2) + "";
  
  if (statIncreaseTotal % 2 !== 0) {
    throw "Invalid merge profile";
  }
  
  if (statIncreaseTotal > 0) {
    mergeProfile += Utilities.formatString(" (%s)", merges.join("/"));
  }
  
  return mergeProfile;
}

/* Extracts the banner name from the active sheet name. */
function BANNER_NAME() {
  var sheetName = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName();

  return bannerNamePattern.exec(sheetName)[1];
}

/* Computes the IV and merge profile for the inventory's current row. */
function getIvIndicesAndMerges() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var iSheet = spreadsheet.getActiveSheet();
  var iRowIndex = iSheet.getActiveSelection().getRowIndex();
  var iName = spreadsheet.getRangeByName("I_name").getCell(iRowIndex, 1).getValue();
  var iLevel = parseInt(spreadsheet.getRangeByName("I_level").getCell(iRowIndex, 1).getValue());
  var iRarity = parseInt(spreadsheet.getRangeByName("I_rarity").getCell(iRowIndex, 1).getValue());
  
  var hNames = spreadsheet.getRangeByName("H_name");
  var hRowIndex = findRowIndexInColumn(hNames, iName);
  
  if (hRowIndex === 0) {
    throw Utilities.formatString("Invalid hero name %s", iName);
  }
  
  if (iLevel !== 40 && iLevel !== 1) {
    throw Utilities.formatString("Invalid hero level %d", iLevel);
  }
  
  var stats = iStatNames.map(function (statName) {
    return parseInt(spreadsheet.getRangeByName(Utilities.formatString("I_%s", statName)).getCell(iRowIndex, 1).getValue());
  });
  
  if (iLevel === 40) {
    var ivNames = ["U", "N", "L"];
    
    var ivs = hStatNames.map(function (statName) {
      return ivNames.map(function (ivName) {
        return parseInt(
          spreadsheet.getRangeByName(Utilities.formatString("H_%s%s_%d_%d", statName, ivName, iRarity, iLevel))
          .getCell(hRowIndex, 1).getValue()
        );
      });
    });
  } else if (iLevel === 1) {
    /* Level 1 IVs differ by exactly 1. */
    var ivOffsets = [1, 0, -1];
    
    var ivs = hStatNames.map(function (statName) {
      return ivOffsets.map(function (ivOffset) {
        return parseInt(
          spreadsheet.getRangeByName(Utilities.formatString("H_%sN_%d_%d", statName, iRarity, iLevel))
          .getCell(hRowIndex, 1).getValue()
        ) + ivOffset;
      });
    });
  } else {
    throw "Hero level must be 40 or 1";
  }
  
  var statsWithIndex = [];
  
  for (var statIndex in stats) {
    if (isNaN(ivs[statIndex][0]) && isNaN(ivs[statIndex][2])) {
      /* Fill in the missing IVs with impossible values which have no chance of being assigned. */
      ivs[statIndex][0] = 1024;
      ivs[statIndex][2] = -1024;
    }

    statsWithIndex.push([stats[statIndex], statIndex]);
  }
  
  /* Sort in reverse order so that the biggest stat appears first. This is necessary for determining the merge profile.
  
  See `http://feheroes.gamepedia.com/Merge_Allies#Merge_Stat_Bonuses`.
  */
  statsWithIndex.sort(function (lhs, rhs) {
    /* Sort in descending order. */
    if (lhs[0] > rhs[0]) {
      return -1;
    } else if (lhs[0] < rhs[0]) {
      return 1;
    } else {
      /* If two stats are the same, then HP > ATK > SPD > DEF > RES. */
      if (lhs[1] > rhs[1]) {
        return -1;
      } else if (lhs[1] < rhs[1]) {
        return 1;
      } else {
        throw "Control should never reach here";
      }
    }
  });
  
  var statsSorted = statsWithIndex.map(function (tuple) {
    return tuple[0];
  });
  
  var ivsSorted = statsWithIndex.map(function (tuple) {
    return ivs[tuple[1]];
  });
  
  var ivIndexMemo = [];
  var mergeMemo = [];
  
  assignIvAndMerges(ivIndexMemo, mergeMemo, statsSorted, ivsSorted, false, false);
  
  /* The IV indices either get completely filled or not at all by the dynamic programming algorithm. */
  if (ivIndexMemo.length === 0) {
    throw "Could not determine IV and merge information from hero stats; please double check your entry";
  }
  
  var ivIndices = ivIndexMemo.slice(0);
  var merges = mergeMemo.slice(0);
  
  for (var iStat in stats) {
    ivIndices[statsWithIndex[iStat][1]] = ivIndexMemo[iStat];
    merges[statsWithIndex[iStat][1]] = mergeMemo[iStat];
  }
  
  return [ivIndices, merges];
}

/* Use dynamic programming to assign the IV.

Invariants: The hero's stats are sorted in descending order, and IVs are rearranged to reflect this.
 */
function assignIvAndMerges(ivIndexMemo, mergeMemo, stats, ivs, boonAssigned, baneAssigned) {
  var nStats = stats.length;
  
  /* The position of the stat are we trying to assign. */
  var statIndex = ivIndexMemo.length;
  
  if (statIndex >= 2) {
    var valueFirst = mergeMemo[0];
    var valueLast = mergeMemo[statIndex - 1];
    
    /* At least two merges between +n and +(n - 1) have been memoized. */
    var mergedStatDiffLower = Math.max(valueFirst - 1, 0);
    var mergedStatDiffUpper = valueLast;
  } else if (statIndex === 1) {
    var value = mergeMemo[0];
    
    /* One merge of +n has been memoized. */
    var mergedStatDiffLower = Math.max(value - 1, 0);
    var mergedStatDiffUpper = value;
  } else {
    /* Nothing's been memoized. Allow for merged stat differences of up to +4. */
    var mergedStatDiffLower = 0;
    var mergedStatDiffUpper = 4;
  }
  
  ivLoop: for (var ivIndex = 0; ivIndex < 3; ivIndex++) {
    var mergedStatDiff = stats[statIndex] - ivs[statIndex][ivIndex];
    
    if (mergedStatDiff >= mergedStatDiffLower && mergedStatDiff <= mergedStatDiffUpper) {
      switch (ivIndex) {
        case 0:
          /* Has the boon already been assigned? Unwind the recursion because this is illegal. */
          if (boonAssigned) {
            continue ivLoop;
          }
          
          boonAssigned = true;
          
          break;
        case 2:
          /* Has the bane already been assigned? Unwind the recursion because this is illegal. */
          if (baneAssigned) {
            continue ivLoop;
          }
          
          baneAssigned = true;
          
          break;
      }
      
      /* Add to the memos. */
      ivIndexMemo.push(ivIndex);
      mergeMemo.push(mergedStatDiff);
      
      if (ivIndexMemo.length < nStats) {
        /* Solve the subproblem. */
        assignIvAndMerges(ivIndexMemo, mergeMemo, stats, ivs, boonAssigned, baneAssigned);

        /* The subproblem assigned all IV stats; stop backtracking. */
        if (ivIndexMemo.length === nStats) {
          return;
        }
      } else {
        /* All IV stats got assigned; there are no more subproblems to solve. */
        return;
      }
      
      /* Backtrack by reverting the memos. */
      ivIndexMemo.pop();
      mergeMemo.pop();
    }
  }
}

/* Finds the row index of the given value in the given range. */
function findRowIndexInColumn(range, value) {
  var values = range.getValues();
  
  for (var iValue in values) {
    if (values[iValue][0] === value) {
      return parseInt(iValue) + range.getRowIndex();
    }
  }
  
  return 0;
}

/* Detects changes to various sheets and manipulates data accordingly. */
function onEdit(event) {
  var sheet = event.source.getActiveSheet();
  
  if (bannerNamePattern.exec(sheet.getName()) === null) {
    return;
  }
  
  var cell = sheet.getActiveCell();
  
  if (cell.getColumnIndex() === 1) {
    sheet.getRange(sheet.getFrozenRows() + 1, 1, sheet.getMaxRows() - 1, 1).sort([{column: 1, ascending: true}]);
  }
}
