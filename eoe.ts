/* Edge of Eternities: Ships! Planets!
 * Notes:
 * * There's a starmap, which is a hex grid with radius ~44 (exact # to be determined), planets,
 *   and ships. Planets might be randomly discovered (i.e. created) when a player moves to an
 *   unseen space. Planets can also be destroyed.
 * * Grid configuration, planet creation/destruction, ship positioning all exist in a log in
 *   the league's sheet. That is the source of truth.
 * * On each loss, players get a prompt to pick a pack from any discvoered unexploded planet.
 *   * Unresolved: is it picked from planets _at the time of loss_ or _at the time of choice_?
 *     What happens if a player banks a choice over a week boundary or waits for a discovery?
 * * On each win, players get a prompt to move their ship (or place it then move it, if it
 *   hasn't been placed). They move 3 spaces, specifying directions.
 *   * The message prompting their moves should have a preview of the map with the move,
 *     to make it easier to visualize.
 *   * Unclaimed moves get transferred to the ship's captain at the end of the week. They can
 *     still be made by the player. So we'll need to track 2 messages potentially.
 *     * Allowing both removes awkward edge cases around just-before-end-of-week matches.
 * * On planet discovery (part of the movement implementation) each player on that ship gets
 *   an identical rare/mythic from that set.
 */
