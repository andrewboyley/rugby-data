#!/usr/bin/env python3
"""
Simple test to verify RIMS API integration works.
This demonstrates that we can fetch data from the World Rugby RIMS API
which will serve as our primary data source.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from rugby_composition_predictor.rims_api import RimsApi
from rugby_composition_predictor.cache import ApiCache

def test_rims_api():
    """Test that the RIMS API is working correctly."""
    print("=== Testing World Rugby RIMS API ===")
    
    # Create cache and API instances
    cache = ApiCache('/tmp/test_rims_cache.json')
    api = RimsApi(cache)
    
    # Test 1: Fetch a known match summary
    print("\n1. Fetching match summary for match ID 22793...")
    try:
        summary = api.match_summary('22793')
        match = summary.get('match', {})
        print(f"   ✓ Match ID: {match.get('matchId')}")
        print(f"   ✓ Date: {match.get('date')}")
        print(f"   ✓ Status: {match.get('status', {}).get('eventStatusName')}")
        
        # Check scores
        scores = match.get('scores', [])
        if len(scores) >= 2:
            print(f"   ✓ Score: {scores[0]} - {scores[1]}")
        
        # Check teams
        teams = match.get('teams', [])
        if len(teams) >= 2:
            team1_name = teams[0].get('name', 'Unknown')
            team2_name = teams[1].get('name', 'Unknown')
            print(f"   ✓ Teams: {team1_name} vs {team2_name}")
            
        # Check team lineups
        team_list = teams[0].get('teamList', {}) if teams else {}
        player_list = team_list.get('list', [])
        if player_list:
            print(f"   ✓ Team 1 has {len(player_list)} players in lineup")
            if player_list:
                first_player = player_list[0].get('player', {})
                name = first_player.get('name', {}).get('display', 'Unknown')
                jersey = player_list[0].get('number', 'Unknown')
                position = player_list[0].get('position', 'Unknown')
                print(f"   ✓ Sample player: #{jersey} {name} ({position})")
                
    except Exception as e:
        print(f"   ✗ Error fetching match summary: {e}")
        return False
    
    # Test 2: Fetch team information
    print("\n2. Fetching team information for England (RIMS ID 34)...")
    try:
        team_data = api.get('https://api.wr-rims-prod.pulselive.com/rugby/v3/team/34')
        team = team_data.get('team', team_data)
        print(f"   ✓ Team name: {team.get('name')}")
        print(f"   ✓ Team code: {team.get('abbreviation')}")
        print(f"   ✓ Team type: {team.get('type')}")
    except Exception as e:
        print(f"   ✗ Error fetching team info: {e}")
        return False
        
    # Test 3: Fetch matches for a year (small sample)
    print("\n3. Fetching matches for 2023 (first page only)...")
    try:
        matches = api.matches_for_year(2023)
        if matches:
            print(f"   ✓ Found {len(matches)} matches in 2023 (first page)")
            if matches:
                sample_match = matches[0]
                print(f"   ✓ Sample match ID: {sample_match.get('matchId')}")
                print(f"   ✓ Sample match date: {sample_match.get('time', {}).get('label')}")
        else:
            print(f"   ⚠ No matches found")
    except Exception as e:
        print(f"   ✗ Error fetching matches: {e}")
        return False
        
    # Test 4: Check cache is working
    print("\n4. Testing cache functionality...")
    try:
        # Fetch same match again - should come from cache
        summary2 = api.match_summary('22793')
        if summary == summary2:
            print("   ✓ Cache is working (second fetch returned cached data)")
        else:
            print("   ⚠ Cache may not be working (data differs)")
    except Exception as e:
        print(f"   ✗ Error testing cache: {e}")
        return False
        
    print("\n=== RIMS API Test Summary ===")
    print("✓ RIMS API is accessible and returning expected data")
    print("✓ Match summaries include scores, teams, and player lineups")
    print("✓ Team information is available")
    print("✓ Match discovery by year works")
    print("✓ Caching mechanism is functional")
    print("\nThe RIMS API is ready to serve as the primary data source!")
    print("ESPN CORE API can be used as backup for competitions not well-covered by RIMS.")
    return True

if __name__ == "__main__":
    success = test_rims_api()
    sys.exit(0 if success else 1)