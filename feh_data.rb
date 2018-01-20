#!/usr/bin/env ruby
# -*- coding: utf-8 -*-
#
# Copyright 2017 Roy Liu
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not
# use this file except in compliance with the License. You may obtain a copy of
# the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations under
# the License.

require "csv"
require "json"
require "net/http"
require "optionparser"
require "pathname"

module FireEmblemHeroes
  class Skill
    attr_reader :name, :sp_cost, :type

    def initialize(name, sp_cost, type)
      @name = name
      @sp_cost = sp_cost
      @type = type
    end
  end
end

FEH_STATS_JSON_URL =
    "https://raw.githubusercontent.com" \
      "/ajhyndman/fire-emblem-working-title/master/packages/fire-emblem-heroes-stats/stats.json"

HEADER_MAPPING = {
    stats: {
        "hp" => "H", "atk" => "A", "spd" => "S", "def" => "D", "res" => "R"
    },
    skill_types: {
        "WEAPON" => "Weapon", "ASSIST" => "Assist", "SPECIAL" => "Special",
        "PASSIVE_A" => "A Passive", "PASSIVE_B" => "B Passive", "PASSIVE_C" => "C Passive",
        "SEAL" => "Seal"
    },
    ivs: {
        "N" => 1, "U" => 2, "L" => 0
    }
}

HERO_WEAPON_TYPE_PATTERN = Regexp.new("\\A(Blue|Green|Red|Colorless)" \
  " (Axe|Bow|Breath|Lance|Dagger|Staff|Sword|Tome)\\z")

SKILL_WEAPON_TYPE_PATTERN = Regexp.new("\\A(?:Blue |Green |Red |Colorless |)" \
  "(Axe|Bow|Breath|Lance|Dagger|Staff|Sword|Tome)\\z")

INHERIT_RESTRICTIONS_ONLY_PATTERN = Regexp.new("\\A(.*) Only\\z")

INHERIT_RESTRICTIONS_EXCLUDES_PATTERN = Regexp.new("\\AExcludes (.*)\\z")

HERO_RARITIES_PATTERN = Regexp.new(
    "\\A(?:(\\d)((?:\\-\\d)?)|N/A)(" \
      "Grand Hero Battle|Tempest Trials| \\- Event| \\- Legendary| \\- Special| \\- Story|" \
      ")\\z"
)

FEH_RELEASE_DATE = "2017-02-02"

HEROES_CSV_COLUMN_NAMES = [
    "Name",
    "Color",
    "Weapon Type",
    "Movement Type",
    "Weapon",
    "Assist",
    "Special",
    "A Passive",
    "B Passive",
    "C Passive",
    *[40, 1].reduce([]) do |memo, level|
      memo + ["5", "4", "3"].reduce([]) do |memo, rarity|
        memo + HEADER_MAPPING[:stats].keys.map do |stat|
          "#{stat.upcase} (#{rarity}*, Lv. #{level})"
        end
      end
    end,
    "Rarities",
    "Release Method",
    "Release Date",
    *[5, 4, 3].reduce([]) do |memo, rarity|
      memo + HEADER_MAPPING[:ivs].keys.reduce([]) do |memo, iv|
        memo + HEADER_MAPPING[:stats].values.map do |stat|
          "#{stat}#{iv}_#{rarity}_40"
        end
      end
    end,
    *[5, 4, 3].reduce([]) do |memo, rarity|
      memo + HEADER_MAPPING[:stats].values.map do |stat|
        "#{stat}N_#{rarity}_1"
      end
    end,
    *[5, 4, 3].map do |rarity|
      "Rarity_#{rarity}"
    end
]

SKILLS_CSV_COLUMN_NAMES = [
    "Name",
    "Type",
    "SP Cost",
    "Inherit Restriction",
    "Range",
    "Weapon Might",
    "Effect",
    "Available At 4*",
    "Available At 5*"
]

if __FILE__ == $0
  opts = {
      output_heroes_csv: false,
      output_skills_csv: false,
      filename: nil,
      verbose: false
  }

  positional_args = OptionParser.new do |opt_spec|
    opt_spec.banner = "usage: #{Pathname.new(__FILE__).basename} [<options>]"

    opt_spec.separator ""
    opt_spec.separator "optional arguments:"

    opt_spec.on("--heroes", "output a CSV representation of the heroes JSON") do
      opts[:output_heroes_csv] = true
    end

    opt_spec.on("--skills", "output a CSV representation of the skills JSON") do
      opts[:output_skills_csv] = true
    end

    opt_spec.on("-f", "--file FILE", "the stats JSON file") do |filename|
      opts[:filename] = filename
    end

    opt_spec.on("-v", "--verbose", "be verbose") do
      opts[:verbose] = true
    end
  end.parse(ARGV)

  filename = opts[:filename]
  output_heroes_csv = opts[:output_heroes_csv]
  output_skills_csv = opts[:output_skills_csv]

  raise "Please specify heroes or skills JSON output, but not both" \
    if output_heroes_csv == output_skills_csv

  json_hero_stat_headers = HEADER_MAPPING[:stats].keys
  json_skill_type_headers = HEADER_MAPPING[:skill_types].keys

  if filename
    j = JSON.parse!(Pathname.new(filename).open {|f| f.read})
  else
    j = JSON.parse!(Net::HTTP.get(URI(FEH_STATS_JSON_URL)))
  end

  heroes_csv_out = CSV.new(
      output_heroes_csv ? STDOUT : Pathname.new("/dev/null").open("wb"),
      headers: HEROES_CSV_COLUMN_NAMES, write_headers: true
  )

  skills_csv_out = CSV.new(
      output_skills_csv ? STDOUT : Pathname.new("/dev/null").open("wb"),
      headers: SKILLS_CSV_COLUMN_NAMES, write_headers: true
  )

  skills_by_rarities = Array.new(5) {{}}

  j_skills = j["skills"]

  hero_skills_by_name = Hash[
      j_skills.map do |j_skill|
        skill = FireEmblemHeroes::Skill.new(j_skill["name"], j_skill["spCost"] || j_skill["cost"], j_skill["type"])

        [skill.name, skill]
      end.select do |_, skill|
        skill.type != "SEAL"
      end
  ]

  j["heroes"].each do |j_hero|
    # If the hero doesn't have a release date, then they shouldn't be included.
    next \
      if j_hero["releaseDate"] == "N/A"

    j_weapon_type = j_hero["weaponType"]
    m = HERO_WEAPON_TYPE_PATTERN.match(j_weapon_type)

    raise "Invalid weapon type #{j_weapon_type.dump}" \
      if !m

    _, color, weapon_type = m.to_a
    j_hero_name = j_hero["name"]

    hero_row = CSV::Row.new(HEROES_CSV_COLUMN_NAMES, [])
    hero_row["Name"] = j_hero_name
    hero_row["Color"] = color
    hero_row["Weapon Type"] = weapon_type
    hero_row["Movement Type"] = j_hero["movetype"]

    j_levels = j_hero["stats"]

    j_stats_rarities_40 = j_levels["40"]

    (j_stats_rarities_40.keys & ["5", "4", "3"]).each do |rarity|
      j_stats = j_stats_rarities_40[rarity]

      if j_stats[json_hero_stat_headers.first].size == 3
        # It's a non-neutral IV.
        HEADER_MAPPING[:ivs].each_pair do |iv, iv_index|
          json_hero_stat_headers.each do |stat|
            hero_row["#{HEADER_MAPPING[:stats][stat]}#{iv}_#{rarity}_40"] = j_stats[stat][iv_index]
          end
        end
      else
        # It's a neutral IV.
        json_hero_stat_headers.each do |stat|
          hero_row["#{HEADER_MAPPING[:stats][stat]}N_#{rarity}_40"] = j_stats[stat].first
        end
      end

      json_hero_stat_headers.each do |stat|
        hero_row["#{stat.upcase} (#{rarity}*, Lv. 40)"] = j_stats[stat].reverse.join("/")
      end
    end

    j_stats_rarities_1 = j_levels["1"]

    (j_stats_rarities_1.keys & ["5", "4", "3"]).each do |rarity|
      j_stats = j_stats_rarities_1[rarity]

      json_hero_stat_headers.each do |stat|
        hero_row["#{HEADER_MAPPING[:stats][stat]}N_#{rarity}_1"] = j_stats[stat]
      end

      json_hero_stat_headers.each do |stat|
        if j_stats_rarities_40[rarity][json_hero_stat_headers.first].size == 3
          hero_row["#{stat.upcase} (#{rarity}*, Lv. 1)"] =
              ((j_stats[stat] - 1)..(j_stats[stat] + 1)).to_a.reverse.join("/")
        else
          hero_row["#{stat.upcase} (#{rarity}*, Lv. 1)"] = j_stats[stat]
        end
      end
    end

    skill_type_mapping = j_hero["skills"].reduce({}) do |memo, j_skill|
      skill_name = j_skill["name"]
      skill = hero_skills_by_name[skill_name]

      (memo[skill.type] ||= []).push(skill)

      rarity = j_skill["rarity"]

      case rarity
        when 4, 5
          (skills_by_rarities[rarity.to_i - 1][skill_name] ||= []).push(j_hero_name) \
            if skill_name.end_with?(" 3")
      end

      memo
    end

    json_skill_type_headers.each do |skill_type|
      skills = skill_type_mapping[skill_type]

      next \
        if !skills

      hero_row[HEADER_MAPPING[:skill_types][skill_type]] = skills.sort do |lhs, rhs|
        -(lhs.sp_cost <=> rhs.sp_cost)
      end.first.name
    end

    j_rarities = j_hero["rarity"].to_s
    m = HERO_RARITIES_PATTERN.match(j_rarities)

    raise "Invalid hero rarities #{j_rarities.dump}" \
      if !m

    _, m_lower_rarity, m_upper_rarity, m_release_method = m.to_a

    case m_upper_rarity
      when ""
        lower_rarity = m_lower_rarity.to_i
        upper_rarity = lower_rarity
      when nil
        # This is an Askr story unit, and hence 2-star rarity.
        lower_rarity = upper_rarity = 2
      else
        lower_rarity = m_lower_rarity.to_i
        upper_rarity = m_upper_rarity[1..-1].to_i
    end

    hero_row["Rarities"] = lower_rarity.to_s
    hero_row["Rarities"] += "-#{upper_rarity}" \
      if upper_rarity > lower_rarity

    release_method = case m_release_method
      when " - Event"
        "Event"
      when " - Legendary"
        "Legendary Summoning Event"
      when " - Special"
        "Seasonal"
      when " - Story"
        "Story"
      when "Grand Hero Battle"
        "Grand Hero Battle"
      when "Tempest Trials"
        "Tempest Trials"
      when ""
        nil
      else
        raise "Unknown hero release method #{m_release_method.dump}"
    end

    hero_row["Release Method"] = release_method

    release_date = j_hero["releaseDate"]

    if release_date != ""
      hero_row["Release Date"] = release_date
    else
      # If no release date is given, use the game's release date.
      hero_row["Release Date"] = FEH_RELEASE_DATE
    end

    ([lower_rarity, 3].max..upper_rarity).each do |rarity|
      hero_row["Rarity_#{rarity}"] = 1 \
        if !release_method
    end

    heroes_csv_out << hero_row
  end

  j_skills.each do |j_skill|
    j_skill_name = j_skill["name"]
    j_skill_type = j_skill["type"]
    j_skill_effect = j_skill["effect"]
    j_weapon_type = j_skill["weaponType"]

    skill_row = CSV::Row.new(SKILLS_CSV_COLUMN_NAMES, [])
    skill_row["Name"] = j_skill_name
    skill_row["Type"] = HEADER_MAPPING[:skill_types][j_skill_type]

    if j_skill_effect != "-"
      skill_row["Effect"] = j_skill_effect
    else
      skill_row["Effect"] = nil
    end

    skill_row["SP Cost"] = j_skill["spCost"] || j_skill["cost"]
    skill_row["Range"] = j_skill["range"]
    skill_row["Weapon Might"] = j_skill["might"]

    if j_skill_type != "WEAPON"
      j_inherit_restriction = j_skill["inheritRestriction"]

      skill_row["Inherit Restriction"] = case j_inherit_restriction
        when INHERIT_RESTRICTIONS_ONLY_PATTERN
          "Only #{$1}"
        when INHERIT_RESTRICTIONS_EXCLUDES_PATTERN
          j_inherit_restriction
        when "Is exclusive"
          "Exclusive"
        when nil
          nil
      end
    else
      skill_row["Inherit Restriction"] = if j_skill["exclusive?"] == "No"
        "Only #{j_weapon_type} Users"
      else
        "Exclusive"
      end
    end

    [4, 5].each do |rarity|
      skill_row["Available At #{rarity}*"] = (skills_by_rarities[rarity - 1][j_skill_name] || []).join(", ") \
        if j_skill_type != "SEAL"
    end

    skills_csv_out << skill_row
  end
end
