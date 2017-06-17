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

var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
var stats = ["H", "A", "S", "D", "R"];
var ivs = ["N", "U", "L"];
var rarities = [5, 4, 3];

/* Initializes supporting data structures in the spreadsheet like named ranges and validations. */
function init() {
  for (var iStat in stats) {
    for (var iIv in ivs) {
      for (var iRarity in rarities) {
        var columnName = Utilities.formatString("%s%s_%d_40", stats[iStat], ivs[iIv], rarities[iRarity]);
        createNamedRangeForColumn("Heroes", columnName, "H_" + columnName);
      }
    }
  }

  for (var iStat in stats) {
    for (var iRarity in rarities) {
      var columnName = Utilities.formatString("%sN_%d_1", stats[iStat], rarities[iRarity]);
      createNamedRangeForColumn("Heroes", columnName, "H_" + columnName);
    }
  }
  
  createNamedRangeForColumn("Heroes", "Name", "H_name");
  createNamedRangeForColumn("Heroes", "Color", "H_color");
  createNamedRangeForColumn("Heroes", "Rarity_5", "H_rarity_5");
  createNamedRangeForColumn("Heroes", "Rarity_4", "H_rarity_4");
  createNamedRangeForColumn("Heroes", "Rarity_3", "H_rarity_3");
  createNamedRangeForColumn("Inventory", "Name", "I_name");
  createNamedRangeForColumn("Inventory", "Rarity", "I_rarity");
  createNamedRangeForColumn("Inventory", "Level", "I_level");
  createNamedRangeForColumn("Inventory", "HP", "I_hp");
  createNamedRangeForColumn("Inventory", "ATK", "I_atk");
  createNamedRangeForColumn("Inventory", "SPD", "I_spd");
  createNamedRangeForColumn("Inventory", "DEF", "I_def");
  createNamedRangeForColumn("Inventory", "RES", "I_res");
  createNamedRangeForColumn("Inventory", "Merges", "I_merges");
  createNamedRangeForColumn("Inventory", "Weapon", "I_weapon");
  createNamedRangeForColumn("Inventory", "Special", "I_special");
  createNamedRangeForColumn("Inventory", "A Passive", "I_a_passive");
  createNamedRangeForColumn("Inventory", "B Passive", "I_b_passive");
  createNamedRangeForColumn("Inventory", "C Passive", "I_c_passive");
  createNamedRangeForColumn("Inventory", "Seal", "I_seal");
}

/* Creates a named range on the given column. */
function createNamedRangeForColumn(sheetName, columnName, rangeName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  var range = sheet.getRange(1, 1, 1, sheet.getMaxColumns());
  var columnIndex = range.getValues()[0].indexOf(columnName) + 1;

  if (columnIndex > 0) {
    return spreadsheet.setNamedRange(rangeName, sheet.getRange(1, columnIndex, sheet.getMaxRows(), 1));
  } else {
    throw Utilities.formatString("Column %s not found in sheet %s", columnName, sheetName);
  }
}

/* Destroys all named ranges to start from a clean slate. */
function destroyNamedRanges() {
  var namedRanges = spreadsheet.getNamedRanges();
  
  for (var iNamedRange in namedRanges) {
    namedRanges[iNamedRange].remove();
  }
}
