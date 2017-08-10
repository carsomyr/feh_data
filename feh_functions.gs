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

var iStatNames = ["HP", "ATK", "SPD", "DEF", "RES"];
var hStatNames = ["H", "A", "S", "D", "R"];

/* Creates a mapping from column names to indices for the given sheet. */
function createColumnIndexMapping(sheet) {
  var range = sheet.getRange(sheet.getFrozenRows(), 1, 1, sheet.getMaxColumns());
  var values = range.getValues()[0];
  var mapping = {};
  
  for (var iValue in values) {
    mapping[values[iValue]] = parseInt(iValue) + 1;
  }
  
  return mapping;
}

/* Calculates the IV (invidual values) for a hero. */
function FEH_IV() {
  var tuple = getIvIndicesAndMerges();
  var ivIndices = tuple[0];
  
  var indexHigh = ivIndices.indexOf(0);
  var indexLow = ivIndices.indexOf(2);
  
  if (indexHigh >= 0 && indexLow >= 0) {
    return Utilities.formatString("+%s/-%s", iStatNames[indexHigh].toLowerCase(), iStatNames[indexLow].toLowerCase());
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

/* Computes the IV and merge profile for the inventory's current row. */
function getIvIndicesAndMerges() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var iSheet = spreadsheet.getSheetByName("Inventory");
  var iColumnIndexMapping = createColumnIndexMapping(iSheet);
  var iRowIndex = iSheet.getActiveSelection().getRowIndex();
  var iName = iSheet.getRange(iRowIndex, iColumnIndexMapping["Name"]).getValue();
  var iLevel = parseInt(iSheet.getRange(iRowIndex, iColumnIndexMapping["Level"]).getValue());
  var iRarity = parseInt(iSheet.getRange(iRowIndex, iColumnIndexMapping["Rarity"]).getValue());
  var hSheet = spreadsheet.getSheetByName("Heroes");
  var hColumnIndexMapping = createColumnIndexMapping(hSheet);
  var hNFrozenRows = hSheet.getFrozenRows();
  var hNames = hSheet.getRange(hNFrozenRows + 1, hColumnIndexMapping["Name"], hSheet.getMaxRows() - hNFrozenRows, 1);
  var hRowIndex = findRowIndexInColumn(hNames, iName);
  
  if (hRowIndex === 0) {
    throw Utilities.formatString("Invalid hero name %s", iName);
  }
  
  if (iLevel !== 40 && iLevel !== 1) {
    throw Utilities.formatString("Invalid hero level %d", iLevel);
  }
  
  var stats = iStatNames.map(function (statName) {
    return parseInt(iSheet.getRange(iRowIndex, iColumnIndexMapping[statName]).getValue());
  });
  
  if (iLevel === 40) {
    var ivNames = ["U", "N", "L"];
    
    var ivs = hStatNames.map(function (statName) {
      return ivNames.map(function (ivName) {
        var columnName = Utilities.formatString("%s%s_%d_%d", statName, ivName, iRarity, iLevel);
        
        return parseInt(hSheet.getRange(hRowIndex, hColumnIndexMapping[columnName]).getValue());
      });
    });
  } else if (iLevel === 1) {
    /* Level 1 IVs differ by exactly 1. */
    var ivOffsets = [1, 0, -1];
    
    var ivs = hStatNames.map(function (statName) {
      return ivOffsets.map(function (ivOffset) {
        var columnName = Utilities.formatString("%sN_%d_%d", statName, iRarity, iLevel);
        
        return parseInt(hSheet.getRange(hRowIndex, hColumnIndexMapping[columnName]).getValue()) + ivOffset;
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

    /* Sort by *neutral* IV stats. */
    statsWithIndex.push([ivs[statIndex][1], statIndex, stats[statIndex]]);
  }
  
  /* Sort in reverse order so that the biggest stat appears first. This is necessary for determining the merge profile.
  
  See `http://feheroes.gamepedia.com/Merge_Allies#Merge_Stat_Bonuses` (except it seems like HP is increased first).
  */
  statsWithIndex = [statsWithIndex[0]].concat(statsWithIndex.slice(1, 5).sort(function (lhs, rhs) {
    /* Sort in descending order. */
    if (lhs[0] > rhs[0]) {
      return -1;
    } else if (lhs[0] < rhs[0]) {
      return 1;
    } else {
      /* If two stats are the same, then ATK > SPD > DEF > RES. */
      if (lhs[1] < rhs[1]) {
        return -1;
      } else if (lhs[1] > rhs[1]) {
        return 1;
      } else {
        throw "Control should never reach here";
      }
    }
  }));
  
  var statsSorted = statsWithIndex.map(function (tuple) {
    return tuple[2];
  });
  
  var ivsSorted = statsWithIndex.map(function (tuple) {
    return ivs[tuple[1]];
  });
  
  var ivIndexMemo = [];
  var mergeMemo = [];
  
  if (!assignIvAndMerges(ivIndexMemo, mergeMemo, statsSorted, ivsSorted, false, false)) {
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
  
  if (statIndex >= 1) {
    var valueFirst = mergeMemo[0];
    var valueLast = mergeMemo[statIndex - 1];
    
    /* At least one merge has been memoized. */
    var mergedStatDiffLower = Math.max(valueFirst - 1, 0);
    var mergedStatDiffUpper = valueLast;
  } else {
    /* Nothing's been memoized. Allow for merged stat differences of up to +4. */
    var mergedStatDiffLower = 0;
    var mergedStatDiffUpper = 4;
  }
  
  ivLoop: for (var ivIndex = 0; ivIndex < 3; ivIndex++) {
    var mergedStatDiff = stats[statIndex] - ivs[statIndex][ivIndex];
    var subproblemBoonAssigned = boonAssigned;
    var subproblemBaneAssigned = baneAssigned;
    
    if (mergedStatDiff >= mergedStatDiffLower && mergedStatDiff <= mergedStatDiffUpper) {
      switch (ivIndex) {
        case 0:
          /* Has the boon already been assigned? Unwind the recursion because this is illegal. */
          if (boonAssigned) {
            continue ivLoop;
          }
          
          subproblemBoonAssigned = true;
          
          break;
        case 2:
          /* Has the bane already been assigned? Unwind the recursion because this is illegal. */
          if (baneAssigned) {
            continue ivLoop;
          }
          
          subproblemBaneAssigned = true;
          
          break;
      }
      
      /* Add to the memos. */
      ivIndexMemo.push(ivIndex);
      mergeMemo.push(mergedStatDiff);

      if (ivIndexMemo.length < nStats) {
        /* Solve the subproblem. Stop processing if a positive result is returned. */
        if (assignIvAndMerges(ivIndexMemo, mergeMemo, stats, ivs, subproblemBoonAssigned, subproblemBaneAssigned)) {
          return true;
        }
      } else {
        /* All IV stats got assigned; there are no more subproblems to solve. */
        return true;
      }
      
      /* Backtrack by reverting the memos. */
      ivIndexMemo.pop();
      mergeMemo.pop();
    }
  }
  
  /* No subproblem returned a positive result, so return a negative result. */
  return false;
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
  
  if (sheet.getRange(1, 3).getValue() === "5* Focus") {
    /* The sheet contains banner information. */
    var cell = sheet.getActiveCell();
    
    if (cell.getColumnIndex() === 1) {
      var nFrozenRows = sheet.getFrozenRows();
      
      sheet.getRange(nFrozenRows + 1, 1, sheet.getMaxRows() - nFrozenRows, 1).sort([{column: 1, ascending: true}]);
      
      if (cell.getRowIndex() === 1) {
        sheet.setName("Banner: " + cell.getValue());
      }
    }
  } else if (false) {
    /* Handle other types of sheets here. */
  }
}
