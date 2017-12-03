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
var ivNatures = [
  [0, 2, 1, 1, 1],
  [0, 1, 2, 1, 1],
  [0, 1, 1, 2, 1],
  [0, 1, 1, 1, 2],
  [1, 0, 2, 1, 1],
  [1, 0, 1, 2, 1],
  [1, 0, 1, 1, 2],
  [1, 1, 0, 2, 1],
  [1, 1, 0, 1, 2],
  [1, 1, 1, 0, 2],
  [2, 0, 1, 1, 1],
  [2, 1, 0, 1, 1],
  [2, 1, 1, 0, 1],
  [2, 1, 1, 1, 0],
  [1, 2, 0, 1, 1],
  [1, 2, 1, 0, 1],
  [1, 2, 1, 1, 0],
  [1, 1, 2, 0, 1],
  [1, 1, 2, 1, 0],
  [1, 1, 1, 2, 0],
  [1, 1, 1, 1, 1]
];

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
    
  /* Level 1 IVs differ by exactly 1. */
  var ivOffsets = [1, 0, -1];
  
  var ivs1 = hStatNames.map(function (statName) {
    return ivOffsets.map(function (ivOffset) {
      var columnName = Utilities.formatString("%sN_%d_%d", statName, iRarity, 1);
      
      return parseInt(hSheet.getRange(hRowIndex, hColumnIndexMapping[columnName]).getValue()) + ivOffset;
    });
  });
  
  var ivs = null;
  
  switch (iLevel) {
    case 40:
      var ivNames = ["U", "N", "L"];
      
      ivs = hStatNames.map(function (statName) {
        return ivNames.map(function (ivName) {
          var columnName = Utilities.formatString("%s%s_%d_%d", statName, ivName, iRarity, iLevel);
          
          return parseInt(hSheet.getRange(hRowIndex, hColumnIndexMapping[columnName]).getValue());
        });
      });
      
      break;
    case 1:
      ivs = ivs1;
      break;
    default:
      throw "Hero level must be 40 or 1";
  }
  
  for (var iStat in stats) {
    if (isNaN(ivs[iStat][0]) && isNaN(ivs[iStat][2])) {
      /* Fill in the missing IVs with impossible values which have no chance of being assigned. */
      ivs[iStat][0] = 1024;
      ivs[iStat][2] = -1024;
    }
  }
  
  return assignIvAndMerges(stats, ivs, ivs1);
}

/* Searches for the IV and merge profile that explain the hero's stats. */
function assignIvAndMerges(stats, ivs, ivs1) {
  ivLoop: for (var iIvNature in ivNatures) {
    var ivNature = ivNatures[iIvNature];
    var ivStatTuples = [];
    var nStats = ivNature.length;
    
    for (var iStat in stats) {
      var ivStat = ivs[iStat][ivNature[iStat]];
      var ivStat1 = ivs1[iStat][ivNature[iStat]];
      var mergedStatDiff = stats[iStat] - ivStat;
      
      /* Bail on the current IV if the stat has an impossible value. */
      if (!(mergedStatDiff >= 0 && mergedStatDiff <= 4)) {
        continue ivLoop;
      }
      
      ivStatTuples.push([ivStat, ivStat1, iStat, mergedStatDiff]);
    }
    
    /* Sort in reverse order so that the biggest stat appears first. This is necessary for determining the merge profile.
    
    See `http://feheroes.gamepedia.com/Merge_Allies#Merge_Stat_Bonuses` for a thorough explanation.
    */
    ivStatTuples = ivStatTuples.sort(function (lhs, rhs) {
      /* Sort in descending order by level 1 stats. */
      if (lhs[1] > rhs[1]) {
        return -1;
      } else if (lhs[1] < rhs[1]) {
        return 1;
      } else {
        /* If two stats are the same, then ATK > SPD > DEF > RES. */
        if (lhs[2] < rhs[2]) {
          return -1;
        } else if (lhs[2] > rhs[2]) {
          return 1;
        } else {
          throw "Control should never reach here";
        }
      }
    });
    
    var diff = ivStatTuples[0][3] - ivStatTuples[nStats - 1][3];
    
    /* Check the validity of the merge profile. */
    
    /* The total variation in differences in no more than 1. */
    if (!(diff >= 0 && diff <= 1)) {
      continue ivLoop;
    }
    
    for (var iStat = 1; iStat < nStats; iStat++) {
      /* The differences are monotonically decreasing. */
      if (!(ivStatTuples[iStat - 1][3] >= ivStatTuples[iStat][3])) {
        continue ivLoop;
      }
    }
    
    var merges = stats.slice(0);
    
    for (var iStat in stats) {
      merges[ivStatTuples[iStat][2]] = ivStatTuples[iStat][3];
    }
    
    /* Found a suitable IV and merge profile. */
    return [ivNature, merges];
  }
  
  throw "Could not determine IV and merge information from hero stats; please double check your entry";
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
